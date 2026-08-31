using System.Collections.Concurrent;
using System.Globalization;
using System.Text;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;

namespace CyTask.Api.Migrations;

internal sealed class MigrationService(
    MigrationSourceClient sourceClient,
    IWorkspaceStore store,
    WorkspaceEventHub events)
{
    private static readonly TimeSpan PreviewLifetime = TimeSpan.FromMinutes(30);
    private readonly ConcurrentDictionary<Guid, Snapshot> _snapshots = [];

    public async Task<MigrationPreview> AnalyzeAsync(
        Guid organizationId, Guid userId, MigrationAnalyzeRequest request,
        CancellationToken cancellationToken)
    {
        if (request.TargetProjectId == Guid.Empty)
            throw new MigrationValidationException("A target CyTask project is required.");
        if (request.MaxItems is < 1 or > 2_000)
            throw new MigrationValidationException("The import limit must be between 1 and 2000 tasks.");

        var targetStatuses = await store.GetProjectStatusesAsync(
            organizationId, request.TargetProjectId, cancellationToken);
        if (targetStatuses is null)
            throw new MigrationNotFoundException("The target project does not exist.");

        PruneExpired();
        var normalized = await sourceClient.FetchAsync(request, cancellationToken);
        var members = await store.ListMembersAsync(organizationId, cancellationToken);
        var snapshot = new Snapshot(
            Guid.CreateVersion7(), organizationId, userId, request.TargetProjectId,
            DateTimeOffset.UtcNow.Add(PreviewLifetime), normalized);
        _snapshots[snapshot.Id] = snapshot;
        return CreatePreview(snapshot, targetStatuses, members);
    }

    public async Task<MigrationImportResult> ImportAsync(
        Guid organizationId, Guid userId, Guid previewId, MigrationImportRequest request,
        CancellationToken cancellationToken)
    {
        PruneExpired();
        if (!_snapshots.TryGetValue(previewId, out var snapshot)
            || snapshot.OrganizationId != organizationId || snapshot.UserId != userId)
            throw new MigrationNotFoundException("The migration preview has expired or is unavailable.");

        await snapshot.Gate.WaitAsync(cancellationToken);
        try
        {
            if (snapshot.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                _snapshots.TryRemove(previewId, out _);
                throw new MigrationNotFoundException("The migration preview has expired.");
            }

            var statuses = await store.GetProjectStatusesAsync(
                organizationId, snapshot.TargetProjectId, cancellationToken)
                ?? throw new MigrationNotFoundException("The target project no longer exists.");
            var members = await store.ListMembersAsync(organizationId, cancellationToken);
            var statusMap = await BuildStatusMapAsync(
                snapshot, request.StatusMappings ?? [], statuses,
                organizationId, userId, cancellationToken);
            var assigneeMap = BuildAssigneeMap(
                snapshot, request.AssigneeMappings ?? [], members);
            var taskBySourceId = await FindExistingImportsAsync(
                snapshot, organizationId, cancellationToken);

            var warnings = new List<string>(snapshot.Migration.Warnings);
            var imported = new List<MigrationImportedItem>();
            var labelsCreated = 0;
            ProjectLabel? rootLabel = null;
            var labelsByName = new Dictionary<string, ProjectLabel>(StringComparer.OrdinalIgnoreCase);
            if (request.CreateLabels)
            {
                (rootLabel, labelsByName, labelsCreated) = await PrepareLabelsAsync(
                    snapshot, organizationId, userId, warnings, cancellationToken);
            }

            var commentsCreated = 0;
            var checklistItemsCreated = 0;
            var created = 0;
            var skipped = 0;
            var failed = 0;

            foreach (var item in snapshot.Migration.Items)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (taskBySourceId.TryGetValue(item.SourceId, out var existing))
                {
                    skipped++;
                    imported.Add(new(item.SourceId, item.SourceKey, existing.Id, existing.Key,
                        "skipped", "Already imported."));
                    continue;
                }

                try
                {
                    var assigneeIds = item.Assignees
                        .Select(person => assigneeMap.GetValueOrDefault(person.Identity))
                        .Where(id => id.HasValue).Select(id => id!.Value)
                        .Distinct().Take(20).ToArray();
                    var task = await store.CreateTaskAsync(
                        organizationId, snapshot.TargetProjectId, userId,
                        Truncate(item.Title, 240), BuildDescription(item, snapshot.Migration.SourceName),
                        item.Priority, item.DueAt, assigneeIds, cancellationToken)
                        ?? throw new InvalidOperationException("The target task could not be created.");

                    var desiredStatus = statusMap.GetValueOrDefault(item.Status, "todo");
                    if (!string.Equals(task.Status, desiredStatus, StringComparison.Ordinal))
                    {
                        var update = await store.UpdateTaskAsync(
                            organizationId, task.Id, userId, task.Title, task.Description,
                            desiredStatus, task.Priority, task.DueAt, assigneeIds,
                            task.Revision, cancellationToken);
                        if (update.Status == UpdateTaskStatus.Updated && update.Task is not null)
                            task = update.Task;
                        else
                            warnings.Add($"{item.SourceKey}: the target status could not be applied.");
                    }

                    if (await store.CreateExternalReferenceAsync(
                        organizationId, task.Id, userId, snapshot.Migration.Source,
                        snapshot.Migration.SourceInstance, "task", Truncate(item.SourceId, 240),
                        Truncate($"{item.SourceKey} · {snapshot.Migration.SourceName}", 240),
                        item.SourceUrl, cancellationToken) is null)
                        warnings.Add($"{item.SourceKey}: the source reference could not be registered.");

                    if (request.CreateLabels)
                    {
                        if (rootLabel is not null)
                            await store.AddTaskLabelAsync(
                                organizationId, task.Id, rootLabel.Id, userId, cancellationToken);

                        foreach (var sourceLabel in item.Labels)
                        {
                            if (!labelsByName.TryGetValue(sourceLabel.Name, out var label))
                            {
                                label = await TryCreateLabelAsync(
                                    snapshot.TargetProjectId, sourceLabel, rootLabel?.Id, labelsByName,
                                    organizationId, userId, warnings, cancellationToken);
                                if (label is not null) labelsCreated++;
                            }
                            if (label is not null)
                                await store.AddTaskLabelAsync(
                                    organizationId, task.Id, label.Id, userId, cancellationToken);
                        }
                    }

                    if (request.ImportChecklists)
                    {
                        foreach (var sourceItem in item.Checklist)
                        {
                            var checklistItem = await store.CreateChecklistItemAsync(
                                organizationId, task.Id, userId,
                                Truncate(sourceItem.Title, 500), cancellationToken);
                            if (checklistItem is null)
                            {
                                warnings.Add($"{item.SourceKey}: one checklist item could not be imported.");
                                continue;
                            }
                            checklistItemsCreated++;
                            if (sourceItem.IsCompleted)
                                await store.UpdateChecklistItemAsync(
                                    organizationId, task.Id, checklistItem.Id, userId,
                                    checklistItem.Title, true, checklistItem.Revision, cancellationToken);
                        }
                    }

                    if (request.ImportComments)
                    {
                        foreach (var sourceComment in item.Comments)
                        {
                            var prefix = sourceComment.CreatedAt is DateTimeOffset at
                                ? $"Imported comment · {sourceComment.Author} · {at.ToUniversalTime():u}"
                                : $"Imported comment · {sourceComment.Author}";
                            var body = Truncate($"{prefix}\n\n{sourceComment.Body}", 20_000);
                            if (await store.AddCommentAsync(
                                organizationId, task.Id, userId, body, cancellationToken) is not null)
                                commentsCreated++;
                        }
                    }

                    taskBySourceId[item.SourceId] = task;
                    created++;
                    imported.Add(new(item.SourceId, item.SourceKey, task.Id, task.Key, "created", null));
                }
                catch (Exception exception) when (exception is not OperationCanceledException)
                {
                    failed++;
                    imported.Add(new(item.SourceId, item.SourceKey, null, null,
                        "failed", SafeFailureMessage(exception)));
                }
            }

            var parentRelationsCreated = 0;
            var dependenciesCreated = 0;
            foreach (var item in snapshot.Migration.Items)
            {
                if (!taskBySourceId.TryGetValue(item.SourceId, out var task)) continue;

                if (request.LinkParents && item.ParentSourceId is not null
                    && taskBySourceId.TryGetValue(item.ParentSourceId, out var parent))
                {
                    var result = await store.SetTaskParentAsync(
                        organizationId, task.Id, parent.Id, userId, cancellationToken);
                    if (result.Status == SetTaskParentStatus.Updated) parentRelationsCreated++;
                    else if (result.Status is SetTaskParentStatus.Cycle or SetTaskParentStatus.SelfParent)
                        warnings.Add($"{item.SourceKey}: the parent relation was rejected.");
                }

                if (!request.LinkDependencies) continue;
                foreach (var sourceDependencyId in item.DependsOnSourceIds)
                {
                    if (!taskBySourceId.TryGetValue(sourceDependencyId, out var dependency)) continue;
                    var result = await store.AddTaskDependencyAsync(
                        organizationId, task.Id, dependency.Id, userId, cancellationToken);
                    if (result.Status == AddTaskDependencyStatus.Created) dependenciesCreated++;
                    else if (result.Status is AddTaskDependencyStatus.Cycle or AddTaskDependencyStatus.SelfDependency)
                        warnings.Add($"{item.SourceKey}: one dependency was rejected.");
                }
            }

            events.Publish(organizationId, "migration.completed", snapshot.TargetProjectId);
            return new MigrationImportResult(
                previewId, snapshot.Migration.Source, snapshot.Migration.SourceName,
                snapshot.TargetProjectId, created, skipped, failed, commentsCreated,
                checklistItemsCreated, labelsCreated, parentRelationsCreated, dependenciesCreated,
                imported, warnings.Distinct(StringComparer.Ordinal).Take(200).ToArray(),
                DateTimeOffset.UtcNow);
        }
        finally
        {
            snapshot.Gate.Release();
        }
    }

    private static MigrationPreview CreatePreview(
        Snapshot snapshot, IReadOnlyList<ProjectStatus> targetStatuses,
        IReadOnlyList<OrganizationMember> members)
    {
        var migration = snapshot.Migration;
        var statuses = migration.Items
            .GroupBy(item => item.Status, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var first = group.First();
                return new MigrationSourceStatus(
                    first.Status, first.StatusColor, group.Count(),
                    SuggestStatus(first.Status, targetStatuses));
            })
            .OrderByDescending(status => status.TaskCount)
            .ThenBy(status => status.Name, StringComparer.OrdinalIgnoreCase).ToArray();
        var assignees = migration.Items.SelectMany(item => item.Assignees)
            .GroupBy(person => person.Identity, StringComparer.OrdinalIgnoreCase)
            .Select(group =>
            {
                var first = group.First();
                var member = members.FirstOrDefault(candidate =>
                    first.Email is not null
                    && string.Equals(candidate.Email, first.Email, StringComparison.OrdinalIgnoreCase))
                    ?? members.FirstOrDefault(candidate =>
                        string.Equals(candidate.DisplayName, first.DisplayName, StringComparison.OrdinalIgnoreCase));
                return new MigrationSourceAssignee(
                    first.Identity, first.DisplayName, first.Email, group.Count(), member?.UserId);
            })
            .OrderByDescending(person => person.TaskCount)
            .ThenBy(person => person.DisplayName, StringComparer.OrdinalIgnoreCase).ToArray();

        var summary = new MigrationSummary(
            migration.Items.Count,
            migration.Items.Sum(item => item.Comments.Count),
            migration.Items.Sum(item => item.Checklist.Count),
            migration.Items.Sum(item => item.Attachments.Count),
            migration.Items.Count(item => item.ParentSourceId is not null),
            migration.Items.Sum(item => item.DependsOnSourceIds.Count));
        var previews = migration.Items.Take(250)
            .Select(item => new MigrationPreviewItem(
                item.SourceId, item.SourceKey, item.Title, item.Status, item.Priority,
                item.SourceCreatedAt, item.SourceUpdatedAt, item.DueAt,
                item.Assignees.Select(person => person.DisplayName).ToArray(),
                item.Comments.Count, item.Checklist.Count, item.Attachments.Count,
                item.ParentSourceId is not null, item.DependsOnSourceIds.Count)).ToArray();
        var warnings = migration.Warnings.ToList();
        if (migration.Items.Count > previews.Length)
            warnings.Add($"Only the first {previews.Length} tasks are displayed in this preview.");

        return new(snapshot.Id, migration.Source, migration.SourceName, migration.SourceInstance,
            snapshot.TargetProjectId, snapshot.ExpiresAt, summary, statuses, assignees, previews, warnings);
    }

    private async Task<Dictionary<string, string>> BuildStatusMapAsync(
        Snapshot snapshot, IReadOnlyList<MigrationStatusMapping> requestedMappings,
        IReadOnlyList<ProjectStatus> initialStatuses, Guid organizationId, Guid userId,
        CancellationToken cancellationToken)
    {
        var targetStatuses = initialStatuses.ToList();
        var requested = requestedMappings
            .Where(mapping => !string.IsNullOrWhiteSpace(mapping.SourceStatus))
            .GroupBy(mapping => mapping.SourceStatus, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key, group => group.Last().TargetStatus,
                StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

        foreach (var sourceStatus in snapshot.Migration.Items
                     .Select(item => new { item.Status, item.StatusColor })
                     .DistinctBy(value => value.Status, StringComparer.OrdinalIgnoreCase))
        {
            requested.TryGetValue(sourceStatus.Status, out var requestedTarget);
            if (requestedTarget == "__create__")
            {
                var existing = targetStatuses.FirstOrDefault(status =>
                    string.Equals(status.Name, sourceStatus.Status, StringComparison.OrdinalIgnoreCase));
                if (existing is not null)
                {
                    result[sourceStatus.Status] = existing.Key;
                    continue;
                }
                if (targetStatuses.Count < 25)
                {
                    var created = await store.CreateProjectStatusAsync(
                        organizationId, snapshot.TargetProjectId, userId,
                        CreateUniqueStatusKey(sourceStatus.Status, targetStatuses),
                        Truncate(sourceStatus.Status, 80), sourceStatus.StatusColor, cancellationToken);
                    if (created is not null)
                    {
                        targetStatuses.Add(created);
                        result[sourceStatus.Status] = created.Key;
                        continue;
                    }
                }
            }
            else if (!string.IsNullOrWhiteSpace(requestedTarget)
                     && targetStatuses.Any(status => status.Key == requestedTarget))
            {
                result[sourceStatus.Status] = requestedTarget;
                continue;
            }
            result[sourceStatus.Status] = SuggestStatus(sourceStatus.Status, targetStatuses);
        }
        return result;
    }

    private static Dictionary<string, Guid?> BuildAssigneeMap(
        Snapshot snapshot, IReadOnlyList<MigrationAssigneeMapping> requestedMappings,
        IReadOnlyList<OrganizationMember> members)
    {
        var memberIds = members.Select(member => member.UserId).ToHashSet();
        var requested = requestedMappings
            .Where(mapping => !string.IsNullOrWhiteSpace(mapping.SourceIdentity))
            .GroupBy(mapping => mapping.SourceIdentity, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(group => group.Key,
                group => group.Last().TargetUserId is Guid id && memberIds.Contains(id) ? id : (Guid?)null,
                StringComparer.OrdinalIgnoreCase);
        var result = new Dictionary<string, Guid?>(StringComparer.OrdinalIgnoreCase);
        foreach (var person in snapshot.Migration.Items.SelectMany(item => item.Assignees)
                     .DistinctBy(person => person.Identity, StringComparer.OrdinalIgnoreCase))
        {
            if (requested.TryGetValue(person.Identity, out var target))
            {
                result[person.Identity] = target;
                continue;
            }
            var member = members.FirstOrDefault(candidate => person.Email is not null
                && string.Equals(candidate.Email, person.Email, StringComparison.OrdinalIgnoreCase))
                ?? members.FirstOrDefault(candidate =>
                    string.Equals(candidate.DisplayName, person.DisplayName, StringComparison.OrdinalIgnoreCase));
            result[person.Identity] = member?.UserId;
        }
        return result;
    }

    private async Task<Dictionary<string, WorkItem>> FindExistingImportsAsync(
        Snapshot snapshot, Guid organizationId, CancellationToken cancellationToken)
    {
        var tasks = await store.ListTasksAsync(
            organizationId, snapshot.TargetProjectId, cancellationToken) ?? [];
        var tasksById = tasks.ToDictionary(task => task.Id);
        var references = await store.ListProjectExternalReferencesAsync(
            organizationId, snapshot.TargetProjectId, cancellationToken) ?? [];
        var result = new Dictionary<string, WorkItem>(StringComparer.Ordinal);
        foreach (var reference in references)
            if (reference.Provider == snapshot.Migration.Source
                && reference.Repository == snapshot.Migration.SourceInstance
                && reference.ReferenceType == "task"
                && tasksById.TryGetValue(reference.TaskId, out var task))
                result.TryAdd(reference.ReferenceValue, task);
        return result;
    }

    private async Task<(ProjectLabel? Root, Dictionary<string, ProjectLabel> Labels, int Created)> PrepareLabelsAsync(
        Snapshot snapshot, Guid organizationId, Guid userId, List<string> warnings,
        CancellationToken cancellationToken)
    {
        var overview = await store.GetProjectLabelsAsync(
            organizationId, snapshot.TargetProjectId, cancellationToken);
        if (overview is null) return (null, new(StringComparer.OrdinalIgnoreCase), 0);

        var labels = overview.Labels.ToDictionary(label => label.Name, StringComparer.OrdinalIgnoreCase);
        var rootName = Truncate(
            $"{(snapshot.Migration.Source == "jira" ? "Jira" : "ClickUp")} · {snapshot.Migration.SourceName}", 80);
        if (labels.TryGetValue(rootName, out var existing)) return (existing, labels, 0);
        if (labels.Count >= 64)
        {
            warnings.Add("The project label limit was reached; source folders were not created.");
            return (null, labels, 0);
        }

        var root = await store.CreateProjectLabelAsync(
            organizationId, snapshot.TargetProjectId, userId, rootName,
            snapshot.Migration.Source == "jira" ? "#2684FF" : "#7B68EE",
            null, cancellationToken);
        if (root is not null)
        {
            labels[root.Name] = root;
            return (root, labels, 1);
        }
        warnings.Add("The source folder could not be created.");
        return (null, labels, 0);
    }

    private async Task<ProjectLabel?> TryCreateLabelAsync(
        Guid targetProjectId, NormalizedMigrationLabel sourceLabel, Guid? parentLabelId,
        Dictionary<string, ProjectLabel> labels, Guid organizationId, Guid userId,
        List<string> warnings, CancellationToken cancellationToken)
    {
        if (labels.Count >= 64)
        {
            warnings.Add("The project label limit was reached; some source labels were skipped.");
            return null;
        }
        var name = Truncate(sourceLabel.Name.Trim(), 80);
        if (name.Length == 0) return null;
        var label = await store.CreateProjectLabelAsync(
            organizationId, targetProjectId, userId, name,
            sourceLabel.Color, parentLabelId, cancellationToken);
        if (label is not null) labels[label.Name] = label;
        return label;
    }

    private static string BuildDescription(NormalizedMigrationItem item, string sourceName)
    {
        var metadata = new StringBuilder();
        metadata.AppendLine().AppendLine().AppendLine("---");
        metadata.AppendLine("Imported from " + sourceName + " · " + item.SourceKey);
        if (item.SourceUrl is not null) metadata.AppendLine(item.SourceUrl);
        if (item.SourceCreatedAt is DateTimeOffset sourceCreatedAt)
            metadata.AppendLine("Original creation: " + sourceCreatedAt.ToUniversalTime().ToString("u", CultureInfo.InvariantCulture));
        if (item.SourceUpdatedAt is DateTimeOffset sourceUpdatedAt)
            metadata.AppendLine("Original update: " + sourceUpdatedAt.ToUniversalTime().ToString("u", CultureInfo.InvariantCulture));
        if (item.Assignees.Count > 0)
            metadata.AppendLine("Original assignees: "
                + string.Join(", ", item.Assignees.Select(person => person.DisplayName)));
        if (item.Attachments.Count > 0)
        {
            metadata.AppendLine().AppendLine("Source attachments:");
            foreach (var attachment in item.Attachments)
                metadata.AppendLine("- " + attachment.Name + ": " + attachment.Url);
        }

        var suffix = Truncate(metadata.ToString(), 20_000);
        var available = Math.Max(0, 20_000 - suffix.Length);
        return item.Description.Length <= available
            ? item.Description + suffix
            : item.Description[..available] + suffix;
    }

    private static string SuggestStatus(string sourceStatus, IReadOnlyList<ProjectStatus> targetStatuses)
    {
        var exact = targetStatuses.FirstOrDefault(status =>
            string.Equals(status.Name, sourceStatus, StringComparison.OrdinalIgnoreCase));
        if (exact is not null) return exact.Key;

        var normalized = sourceStatus.Trim().ToLowerInvariant();
        var preferred = normalized.Contains("cancel") || normalized.Contains("won't") || normalized.Contains("wont")
            ? "cancelled"
            : normalized.Contains("block") || normalized.Contains("imped") ? "blocked"
            : normalized.Contains("done") || normalized.Contains("complete")
              || normalized.Contains("closed") || normalized.Contains("resolve") ? "done"
            : normalized.Contains("progress") || normalized.Contains("doing")
              || normalized.Contains("review") || normalized.Contains("active") ? "in_progress"
            : "todo";
        return targetStatuses.FirstOrDefault(status => status.Key == preferred)?.Key
            ?? targetStatuses[0].Key;
    }

    private static string CreateUniqueStatusKey(string name, IReadOnlyList<ProjectStatus> statuses)
    {
        var builder = new StringBuilder();
        foreach (var character in name.ToLowerInvariant())
        {
            if (character is >= 'a' and <= 'z' or >= '0' and <= '9') builder.Append(character);
            else if (builder.Length > 0 && builder[^1] != '_') builder.Append('_');
        }

        var baseKey = builder.ToString().Trim('_');
        if (baseKey.Length == 0) baseKey = "imported";
        baseKey = Truncate(baseKey, 40);
        var key = baseKey;
        for (var suffix = 2; statuses.Any(status => status.Key == key); suffix++)
        {
            var suffixText = "_" + suffix.ToString(CultureInfo.InvariantCulture);
            key = Truncate(baseKey, 40 - suffixText.Length) + suffixText;
        }
        return key;
    }

    private void PruneExpired()
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var pair in _snapshots)
            if (pair.Value.ExpiresAt <= now) _snapshots.TryRemove(pair.Key, out _);
    }

    private static string SafeFailureMessage(Exception exception) =>
        exception is InvalidOperationException ? Truncate(exception.Message, 240)
            : "The item could not be imported.";
    private static string Truncate(string value, int maximum) =>
        value.Length <= maximum ? value : value[..maximum];

    private sealed class Snapshot(
        Guid id, Guid organizationId, Guid userId, Guid targetProjectId,
        DateTimeOffset expiresAt, NormalizedMigration migration)
    {
        public Guid Id { get; } = id;
        public Guid OrganizationId { get; } = organizationId;
        public Guid UserId { get; } = userId;
        public Guid TargetProjectId { get; } = targetProjectId;
        public DateTimeOffset ExpiresAt { get; } = expiresAt;
        public NormalizedMigration Migration { get; } = migration;
        public SemaphoreSlim Gate { get; } = new(1, 1);
    }
}

public sealed class MigrationValidationException(string message) : Exception(message);
public sealed class MigrationNotFoundException(string message) : Exception(message);
