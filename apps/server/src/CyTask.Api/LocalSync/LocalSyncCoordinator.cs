using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using CyTask.Api.Collaboration;
using CyTask.Api.Configuration;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Plugins;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;

namespace CyTask.Api.LocalSync;

public sealed partial class LocalSyncCoordinator(
    IOptions<CyTaskOptions> options,
    DataEncryption encryption,
    DirectoryEncryption directoryEncryption,
    InMemoryWorkspaceStore workspace,
    InMemoryCollaborationStore collaboration,
    InMemoryPluginStore plugins,
    InMemoryCyAnnotaStore annotations,
    CyTask.Api.Spaces.InMemoryProjectSpaceStore spaces,
    InMemoryContentPluginStore contentPlugins,
    LocalStateClock localState,
    CyTask.Api.Realtime.WorkspaceEventHub events,
    ILogger<LocalSyncCoordinator> logger) : BackgroundService, ILocalSyncService
{
    private const int FormatVersion = 1;
    private const long MaxSnapshotBytes = 1024L * 1024 * 1024;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);
    private string? _root;
    private string? _snapshotsPath;
    private string? _conflictsPath;
    private Guid _workspaceId;
    private Guid _deviceId;
    private long _sequence;
    private string? _lastPayloadHash;
    private bool _initialized;
    private long _lastObservedVersion = -1;
    private string? _lastInputSignature;
    private string? _inputSignature;
    private string? _lastPeerSignature;
    private readonly Dictionary<string, CachedSnapshot> _snapshotCache = new(StringComparer.Ordinal);

    public LocalSyncStatus Status { get; private set; } = new(
        options.Value.LocalMode, options.Value.LocalMode ? "local-sync" : "server",
        options.Value.LocalWorkspacePath, null, null, 0, 0, 0, null,
        options.Value.LocalMode ? "Initialisation du dossier local…" : "Mode local désactivé.");

    public async Task InitializeAsync(CancellationToken cancellationToken)
    {
        if (!options.Value.LocalMode || _initialized) return;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (_initialized) return;
            _root = ValidateWorkspacePath(options.Value.LocalWorkspacePath);
            _deviceId = Guid.TryParse(options.Value.LocalDeviceId, out var id) && id != Guid.Empty
                ? id : throw new InvalidOperationException("CyTask:LocalDeviceId doit être un GUID non vide.");

            var metadata = Path.Combine(_root, ".cytask");
            await directoryEncryption.InitializeAsync(metadata, "workspace",
                path => (Path.GetExtension(path) is ".json" or ".tmp") && !path.Contains(Path.DirectorySeparatorChar + "media" + Path.DirectorySeparatorChar, StringComparison.Ordinal),
                true, cancellationToken);
            _snapshotsPath = Path.Combine(metadata, "exchange", "snapshots");
            _conflictsPath = Path.Combine(metadata, "exchange", "conflicts");
            Directory.CreateDirectory(_snapshotsPath);
            Directory.CreateDirectory(_conflictsPath);
            Directory.CreateDirectory(Path.Combine(metadata, "media", "objects"));
            WriteIgnoreFileIfMissing(_root);

            var manifestPath = Path.Combine(metadata, "workspace.json");
            LocalSyncManifest manifest;
            if (File.Exists(manifestPath))
            {
                manifest = await ReadJsonAsync<LocalSyncManifest>(manifestPath, cancellationToken)
                    ?? throw new InvalidDataException("Le manifeste local CyTask est vide.");
                if (manifest.FormatVersion != FormatVersion || manifest.WorkspaceId == Guid.Empty)
                    throw new InvalidDataException("Le format de ce dossier CyTask n’est pas pris en charge.");
            }
            else
            {
                manifest = new(FormatVersion, Guid.NewGuid(), DateTimeOffset.UtcNow,
                    "folder-sync", "immutable-json-snapshots");
                await WriteJsonAsync(manifestPath, manifest, cancellationToken);
            }
            _workspaceId = manifest.WorkspaceId;
            _initialized = true;
            await SynchronizeCoreAsync(true, cancellationToken);
        }
        catch (Exception exception)
        {
            Status = Status with { Message = exception.Message };
            LogInitializationError(logger, exception);
            throw;
        }
        finally { _gate.Release(); }
    }

    public async Task<LocalSyncStatus> FlushAsync(CancellationToken cancellationToken)
    {
        await InitializeAsync(cancellationToken);
        if (!options.Value.LocalMode) return Status;
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await SynchronizeCoreAsync(true, cancellationToken);
            return Status;
        }
        finally { _gate.Release(); }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        if (options.Value.LocalMode && _initialized)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(3));
            try
            {
                await _gate.WaitAsync(timeout.Token);
                try { await SynchronizeCoreAsync(true, timeout.Token); }
                finally { _gate.Release(); }
            }
            catch (OperationCanceledException) { /* L’arrêt ne doit jamais rester bloqué. */ }
        }
        await base.StopAsync(cancellationToken);
    }
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.LocalMode) return;
        await InitializeAsync(stoppingToken);
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(Math.Clamp(options.Value.LocalSyncSeconds, 1, 60)));
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await _gate.WaitAsync(stoppingToken);
                try { await SynchronizeCoreAsync(false, stoppingToken); }
                finally { _gate.Release(); }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception exception)
            {
                Status = Status with { Message = exception.Message };
                LogSynchronizationWarning(logger, exception);
            }
        }
    }

    private async Task SynchronizeCoreAsync(bool force, CancellationToken cancellationToken)
    {
        var envelopes = await ReadLatestSnapshotsAsync(cancellationToken);
        if (!force && _lastObservedVersion == localState.Version && _lastInputSignature == _inputSignature)
            return;
        var tombstones = MergeTombstones(envelopes.SelectMany(x => x.Tombstones ?? []));
        var conflicts = new List<LocalSyncConflict>();
        LocalSyncPayload merged;
        long capturedVersion;
        var restored = false;
        var peerSignature = string.Join('|', envelopes.Where(x => x.DeviceId != _deviceId)
            .OrderBy(x => x.DeviceId).Select(x => $"{x.DeviceId:N}:{x.Sequence}"));
        lock (localState.Gate)
        {
            var current = CapturePayload();
            if (_lastPayloadHash is null && envelopes.Count > 0)
            {
                merged = ApplyTombstones(Merge(envelopes, conflicts), tombstones);
                restored = true;
            }
            else
            {
                var previousOwn = envelopes.FirstOrDefault(x => x.DeviceId == _deviceId);
                if (previousOwn is not null)
                    tombstones = MergeTombstones(tombstones.Concat(DetectDeletions(previousOwn.Payload, current)));
                if (_lastPayloadHash is not null && peerSignature == _lastPeerSignature)
                    merged = current;
                else
                {
                    var currentEnvelope = new LocalSyncEnvelope(FormatVersion, _workspaceId, _deviceId,
                        _sequence, DateTimeOffset.UtcNow, current, tombstones);
                    merged = Merge(envelopes.Where(x => x.DeviceId != _deviceId).Append(currentEnvelope), conflicts);
                }
                merged = ApplyTombstones(merged, tombstones);
                restored = HashJson(merged) != HashJson(current);
            }
            if (restored) RestorePayload(merged);
            capturedVersion = localState.Version;
        }
        var stateHash = HashJson(new SnapshotState(merged, tombstones));
        var lastSnapshotAt = Status.LastSnapshotAt;
        if (stateHash != _lastPayloadHash)
        {
            _sequence = Math.Max(_sequence, envelopes.Where(x => x.DeviceId == _deviceId)
                .Select(x => x.Sequence).DefaultIfEmpty(0).Max()) + 1;
            var envelope = new LocalSyncEnvelope(FormatVersion, _workspaceId, _deviceId,
                _sequence, DateTimeOffset.UtcNow, merged, tombstones);
            await WriteSnapshotAsync(envelope, cancellationToken);
            _lastPayloadHash = stateHash;
            lastSnapshotAt = envelope.CapturedAt;
        }
        _lastObservedVersion = capturedVersion;
        _lastInputSignature = _inputSignature;
        _lastPeerSignature = peerSignature;
        if (restored)
            foreach (var organization in merged.Workspace.Organizations)
                events.Publish(organization.Id, "workspace.synchronized", _workspaceId);
        foreach (var conflict in conflicts.GroupBy(x => x.Id).Select(x => x.First()))
            await WriteConflictAsync(conflict, cancellationToken);

        var snapshots = Directory.EnumerateFiles(_snapshotsPath!, "*.json", SearchOption.AllDirectories).Count();
        var conflictCount = Directory.EnumerateFiles(_conflictsPath!, "*.json").Count();
        var peerCount = envelopes.Select(x => x.DeviceId).Append(_deviceId).Distinct().Count();
        Status = new(true, "local-sync", _root, _workspaceId, _deviceId, peerCount,
            snapshots, conflictCount, lastSnapshotAt,
            conflictCount == 0
                ? "Dossier local synchronisé. Syncthing peut transporter les snapshots en toute sécurité."
                : $"Dossier synchronisé avec {conflictCount} conflit(s) à examiner.");
    }

    private LocalSyncPayload CapturePayload() => new(
        workspace.CaptureLocalState(), collaboration.CaptureLocalState(), plugins.CaptureLocalState(),
        annotations.CaptureLocalState(), spaces.CaptureLocalState(), contentPlugins.CaptureLocalState());

    private void RestorePayload(LocalSyncPayload value)
    {
        workspace.RestoreLocalState(value.Workspace);
        collaboration.RestoreLocalState(value.Collaboration);
        plugins.RestoreLocalState(value.Plugins);
        annotations.RestoreLocalState(value.Annotations ?? []);
        spaces.RestoreLocalState(value.Spaces ?? []);
        contentPlugins.RestoreLocalState(value.ContentPlugins ?? []);
    }

    private LocalSyncPayload Merge(IEnumerable<LocalSyncEnvelope> values, List<LocalSyncConflict> conflicts)
    {
        var sources = values.Where(x => x.FormatVersion == FormatVersion && x.WorkspaceId == _workspaceId)
            .OrderBy(x => x.DeviceId).ThenBy(x => x.Sequence).ToArray();
        var w = new WorkspaceLocalState(
            Stable(sources, x => x.Payload.Workspace.Users, x => x.Id.ToString("N"), "user", conflicts),
            Stable(sources, x => x.Payload.Workspace.Organizations, x => x.Id.ToString("N"), "organization", conflicts),
            Stable(sources, x => x.Payload.Workspace.Memberships, x => $"{x.OrganizationId:N}:{x.UserId:N}", "membership", conflicts),
            MergeProjects(sources, conflicts),
            Versioned(sources, x => x.Payload.Workspace.ProjectStatuses, x => $"{x.ProjectId:N}:{x.Key}", x => x.Revision, "project-status", conflicts),
            Stable(sources, x => x.Payload.Workspace.ProjectLabels, x => x.Id.ToString("N"), "project-label", conflicts),
            Versioned(sources, x => x.Payload.Workspace.TaskLabels, x => $"{x.TaskId:N}:{x.LabelId:N}", x => x.AssignedAt.UtcDateTime.Ticks, "task-label", conflicts),
            MergeTasks(sources, conflicts),
            Versioned(sources, x => x.Payload.Workspace.TaskParents, x => x.TaskId.ToString("N"), x => x.LinkedAt.UtcDateTime.Ticks, "task-parent", conflicts),
            Stable(sources, x => x.Payload.Workspace.Comments, x => x.Id.ToString("N"), "comment", conflicts),
            Stable(sources, x => x.Payload.Workspace.Activity, x => x.Id.ToString("N"), "activity", conflicts),
            Versioned(sources, x => x.Payload.Workspace.Attachments, x => x.Id.ToString("N"), x => (x.ReviewedAt ?? x.CreatedAt).UtcDateTime.Ticks, "attachment", conflicts),
            Stable(sources, x => x.Payload.Workspace.ExternalReferences, x => x.Id.ToString("N"), "external-reference", conflicts),
            Stable(sources, x => x.Payload.Workspace.TaskDependencies, x => $"{x.TaskId:N}:{x.DependsOnTaskId:N}", "task-dependency", conflicts),
            Versioned(sources, x => x.Payload.Workspace.Checklist, x => x.Id.ToString("N"), x => x.Revision, "checklist", conflicts),
            Versioned(sources, x => x.Payload.Workspace.Agents ?? [], x => x.UserId.ToString("N"), x => x.Revision, "agent", conflicts),
            Versioned(sources, x => x.Payload.Workspace.AgentNotifications ?? [], x => x.Id.ToString("N"), x => x.Revision, "agent-notification", conflicts));
        var c = new CollaborationLocalState(
            Versioned(sources, x => x.Payload.Collaboration.Resources, x => x.Id.ToString("N"), x => x.Revision, "resource", conflicts),
            Stable(sources, x => x.Payload.Collaboration.Channels, x => x.Id.ToString("N"), "chat-channel", conflicts),
            Stable(sources, x => x.Payload.Collaboration.Messages, x => x.Id.ToString("N"), "chat-message", conflicts));
        var p = new PluginLocalState(
            Versioned(sources, x => x.Payload.Plugins.ProjectPlugins, x => $"{x.ProjectId:N}:{x.PluginId}", x => x.EnabledAt.UtcDateTime.Ticks, "project-plugin", conflicts),
            Versioned(sources, x => x.Payload.Plugins.TaskData, x => $"{x.TaskId:N}:{x.PluginId}", x => x.Revision, "task-plugin-data", conflicts),
            Stable(sources, x => x.Payload.Plugins.TaskDataHistory, x => $"{x.TaskId:N}:{x.PluginId}:{x.Revision}", "task-plugin-history", conflicts));
        return new(w, c, p, Versioned(sources, x => x.Payload.Annotations ?? [],
            x => x.AttachmentId.ToString("N"), x => x.Revision, "annotation", conflicts),
            Versioned(sources, x => x.Payload.Spaces ?? [], x => x.ProjectId.ToString("N"),
                x => x.Revision, "project-space", conflicts),
            Versioned(sources, x => x.Payload.ContentPlugins ?? [], x => x.Key, x => x.Revision, "content-plugin", conflicts));
    }

    private List<LocalSyncTombstone> DetectDeletions(LocalSyncPayload previous, LocalSyncPayload current)
    {
        var now = DateTimeOffset.UtcNow;
        var result = new List<LocalSyncTombstone>();
        AddMissing(previous.Workspace.ProjectLabels, current.Workspace.ProjectLabels,
            x => x.Id.ToString("N"), _ => 1, "project-label", now, result);
        AddMissing(previous.Workspace.TaskLabels, current.Workspace.TaskLabels,
            x => $"{x.TaskId:N}:{x.LabelId:N}", _ => now.UtcDateTime.Ticks, "task-label", now, result);
        AddMissing(previous.Workspace.TaskParents, current.Workspace.TaskParents,
            x => x.TaskId.ToString("N"), _ => now.UtcDateTime.Ticks, "task-parent", now, result);
        AddMissing(previous.Workspace.TaskDependencies, current.Workspace.TaskDependencies,
            x => $"{x.TaskId:N}:{x.DependsOnTaskId:N}", _ => now.UtcDateTime.Ticks, "task-dependency", now, result);
        AddMissing(previous.Workspace.Checklist, current.Workspace.Checklist,
            x => x.Id.ToString("N"), x => x.Revision + 1, "checklist", now, result);
        AddMissing(previous.Plugins.ProjectPlugins, current.Plugins.ProjectPlugins,
            x => $"{x.ProjectId:N}:{x.PluginId}", _ => now.UtcDateTime.Ticks, "project-plugin", now, result);
        return result;
    }

    private void AddMissing<T>(IEnumerable<T> previous, IEnumerable<T> current,
        Func<T, string> key, Func<T, long> revision, string type, DateTimeOffset deletedAt,
        List<LocalSyncTombstone> result)
    {
        var currentKeys = current.Select(key).ToHashSet(StringComparer.Ordinal);
        foreach (var item in previous.Where(item => !currentKeys.Contains(key(item))))
            result.Add(new LocalSyncTombstone(type, key(item), revision(item), _deviceId, deletedAt));
    }

    private static LocalSyncTombstone[] MergeTombstones(IEnumerable<LocalSyncTombstone> values) =>
        values.GroupBy(x => $"{x.EntityType}:{x.EntityId}", StringComparer.Ordinal)
            .Select(group => group.OrderByDescending(x => x.Revision)
                .ThenByDescending(x => x.DeviceId).First())
            .OrderBy(x => x.EntityType, StringComparer.Ordinal)
            .ThenBy(x => x.EntityId, StringComparer.Ordinal).ToArray();

    private static LocalSyncPayload ApplyTombstones(
        LocalSyncPayload payload, IReadOnlyList<LocalSyncTombstone> tombstones)
    {
        var index = tombstones.ToDictionary(x => $"{x.EntityType}:{x.EntityId}", StringComparer.Ordinal);
        bool Deleted(string type, string id, long revision) =>
            index.TryGetValue($"{type}:{id}", out var tombstone) && tombstone.Revision >= revision;
        var workspaceState = payload.Workspace with
        {
            ProjectLabels = payload.Workspace.ProjectLabels
                .Where(x => !Deleted("project-label", x.Id.ToString("N"), 0)).ToArray(),
            TaskLabels = payload.Workspace.TaskLabels
                .Where(x => !Deleted("task-label", $"{x.TaskId:N}:{x.LabelId:N}", x.AssignedAt.UtcDateTime.Ticks)).ToArray(),
            TaskParents = payload.Workspace.TaskParents
                .Where(x => !Deleted("task-parent", x.TaskId.ToString("N"), x.LinkedAt.UtcDateTime.Ticks)).ToArray(),
            TaskDependencies = payload.Workspace.TaskDependencies
                .Where(x => !Deleted("task-dependency", $"{x.TaskId:N}:{x.DependsOnTaskId:N}", x.CreatedAt.UtcDateTime.Ticks)).ToArray(),
            Checklist = payload.Workspace.Checklist
                .Where(x => !Deleted("checklist", x.Id.ToString("N"), x.Revision)).ToArray()
        };
        var pluginState = payload.Plugins with
        {
            ProjectPlugins = payload.Plugins.ProjectPlugins
                .Where(x => !Deleted("project-plugin", $"{x.ProjectId:N}:{x.PluginId}", x.EnabledAt.UtcDateTime.Ticks)).ToArray()
        };
        return payload with { Workspace = workspaceState, Plugins = pluginState };
    }
    private Project[] MergeProjects(IReadOnlyList<LocalSyncEnvelope> sources, List<LocalSyncConflict> conflicts)
    {
        return sources.SelectMany(source => source.Payload.Workspace.Projects
                .Select(project => new { Project = project, source.DeviceId, source.CapturedAt }))
            .GroupBy(item => item.Project.Id)
            .Select(group =>
            {
                var ordered = group.OrderBy(item => item.CapturedAt).ThenBy(item => item.DeviceId).ToArray();
                var chosen = ordered[^1].Project;
                var metadata = ordered.Select(item => new Owned<Project>(
                    item.Project with { NextTaskNumber = 0 }, item.DeviceId,
                    HashJson(item.Project with { NextTaskNumber = 0 }))).ToArray();
                if (metadata.Select(item => item.Hash).Distinct(StringComparer.Ordinal).Count() > 1)
                    conflicts.Add(CreateConflict("project", chosen.Id.ToString("N"), 0, metadata[0], metadata[^1]));
                return chosen with { NextTaskNumber = ordered.Max(item => item.Project.NextTaskNumber) };
            })
            .OrderBy(project => project.Id).ToArray();
    }

    private WorkItem[] MergeTasks(IReadOnlyList<LocalSyncEnvelope> sources, List<LocalSyncConflict> conflicts)
    {
        var tasks = Versioned(sources, x => x.Payload.Workspace.Tasks,
            x => x.Id.ToString("N"), x => x.Revision, "task", conflicts);
        foreach (var collision in tasks.GroupBy(x => (x.ProjectId, x.Number)).Where(x => x.Count() > 1))
        {
            var pair = collision.OrderBy(x => x.Id).Take(2).ToArray();
            var firstDevice = FindTaskDevice(sources, pair[0].Id);
            var secondDevice = FindTaskDevice(sources, pair[1].Id);
            var firstHash = HashJson(pair[0]);
            var secondHash = HashJson(pair[1]);
            var identity = $"task-number|{collision.Key.ProjectId:N}:{collision.Key.Number}|{pair[0].Id:N}|{pair[1].Id:N}";
            var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
            conflicts.Add(new LocalSyncConflict(id, "task-number",
                $"{collision.Key.ProjectId:N}:{collision.Key.Number}", 0,
                firstDevice, secondDevice, firstHash, secondHash, DateTimeOffset.UtcNow));
        }
        return tasks;
    }

    private static Guid FindTaskDevice(IEnumerable<LocalSyncEnvelope> sources, Guid taskId) =>
        sources.LastOrDefault(source => source.Payload.Workspace.Tasks.Any(task => task.Id == taskId))?.DeviceId
        ?? Guid.Empty;
    private T[] Versioned<T>(IReadOnlyList<LocalSyncEnvelope> sources,
        Func<LocalSyncEnvelope, IReadOnlyList<T>> select, Func<T, string> key,
        Func<T, long> revision, string type, List<LocalSyncConflict> conflicts) =>
        MergeItems(sources, select, key, revision, type, conflicts);

    private T[] Stable<T>(IReadOnlyList<LocalSyncEnvelope> sources,
        Func<LocalSyncEnvelope, IReadOnlyList<T>> select, Func<T, string> key,
        string type, List<LocalSyncConflict> conflicts) =>
        MergeItems(sources, select, key, _ => 0, type, conflicts);

    private T[] MergeItems<T>(IReadOnlyList<LocalSyncEnvelope> sources,
        Func<LocalSyncEnvelope, IReadOnlyList<T>> select, Func<T, string> key,
        Func<T, long> revision, string type, List<LocalSyncConflict> conflicts)
    {
        var result = new Dictionary<string, Owned<T>>(StringComparer.Ordinal);
        foreach (var source in sources)
        foreach (var item in select(source))
        {
            var entityId = key(item);
            var candidate = new Owned<T>(item, source.DeviceId, HashJson(item));
            if (!result.TryGetValue(entityId, out var current)) { result[entityId] = candidate; continue; }
            // Le snapshot courant du même appareil remplace naturellement son snapshot précédent.
            if (current.DeviceId == candidate.DeviceId) { result[entityId] = candidate; continue; }
            var currentRevision = revision(current.Value);
            var candidateRevision = revision(candidate.Value);
            if (candidateRevision > currentRevision) { result[entityId] = candidate; continue; }
            if (candidateRevision < currentRevision) continue;
            if (candidate.Hash == current.Hash) { result[entityId] = candidate; continue; }
            conflicts.Add(CreateConflict(type, entityId, currentRevision, current, candidate));
            if (CompareDevice(candidate.DeviceId, current.DeviceId) > 0) result[entityId] = candidate;
        }
        return result.OrderBy(x => x.Key, StringComparer.Ordinal).Select(x => x.Value.Value).ToArray();
    }

    private static LocalSyncConflict CreateConflict<T>(string type, string entityId, long revision,
        Owned<T> left, Owned<T> right)
    {
        var first = CompareDevice(left.DeviceId, right.DeviceId) <= 0 ? left : right;
        var second = first == left ? right : left;
        var identity = $"{type}|{entityId}|{revision}|{first.DeviceId:N}|{second.DeviceId:N}|{first.Hash}|{second.Hash}";
        var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identity))).ToLowerInvariant();
        return new(id, type, entityId, revision, first.DeviceId, second.DeviceId,
            first.Hash, second.Hash, DateTimeOffset.UtcNow);
    }

    private async Task<IReadOnlyList<LocalSyncEnvelope>> ReadLatestSnapshotsAsync(CancellationToken cancellationToken)
    {
        var result = new List<LocalSyncEnvelope>();
        var signature = new StringBuilder();
        var usedPaths = new HashSet<string>(StringComparer.Ordinal);
        foreach (var directory in Directory.EnumerateDirectories(_snapshotsPath!))
        {
            foreach (var path in Directory.EnumerateFiles(directory, "*.json").OrderByDescending(Path.GetFileName, StringComparer.Ordinal))
            {
                try
                {
                    var info = new FileInfo(path);
                    if (info.Length <= 0) continue;
                    if (info.Length > MaxSnapshotBytes + MaxSnapshotBytes / 4096 + 65536)
                        throw new InvalidDataException("The latest CyTask snapshot exceeds the supported size. Opening an older state has been stopped to preserve project data.");
                    signature.Append(path).Append(':').Append(info.Length).Append(':').Append(info.LastWriteTimeUtc.Ticks).Append('|');
                    usedPaths.Add(path);
                    if (_snapshotCache.TryGetValue(path, out var cached)
                        && cached.Length == info.Length && cached.LastWrite == info.LastWriteTimeUtc)
                    {
                        result.Add(cached.Envelope);
                        break;
                    }
                    await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
                        FileShare.Read | FileShare.Delete, 65536, FileOptions.Asynchronous | FileOptions.SequentialScan);
                    var expected = Path.GetFileNameWithoutExtension(path).Split('-').LastOrDefault();
                    var actual = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
                    if (expected != actual)
                    {
                        if (encryption.Enabled) throw new CryptographicException("An encrypted snapshot fingerprint is invalid. Opening an older state has been stopped.");
                        continue;
                    }
                    stream.Position = 0;
                    await using var decoded = encryption.OpenFile(path, "workspace");
                    if (decoded.Length > MaxSnapshotBytes) throw new CryptographicException("The snapshot exceeds the supported size.");
                    var item = await JsonSerializer.DeserializeAsync<LocalSyncEnvelope>(decoded, _json, cancellationToken);
                    if (item is null || item.FormatVersion != FormatVersion || item.WorkspaceId != _workspaceId) continue;
                    _snapshotCache[path] = new(info.Length, info.LastWriteTimeUtc, item);
                    result.Add(item);
                    break;
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException or JsonException)
                { LogIgnoredSnapshot(logger, path, exception); }
            }
        }
        foreach (var obsolete in _snapshotCache.Keys.Where(path => !usedPaths.Contains(path)).ToArray())
            _snapshotCache.Remove(obsolete);
        _inputSignature = signature.ToString();
        return result;
    }

    private async Task WriteSnapshotAsync(LocalSyncEnvelope envelope, CancellationToken cancellationToken)
    {
        var directory = Path.Combine(_snapshotsPath!, _deviceId.ToString("N"));
        Directory.CreateDirectory(directory);
        var temporary = Path.Combine(directory, $"{Guid.NewGuid():N}.tmp");
        try
        {
            await using (var target = encryption.CreateFile(temporary, "workspace"))
            {
                await JsonSerializer.SerializeAsync(target, envelope, _json, cancellationToken);
                if (target.Length > MaxSnapshotBytes)
                    throw new InvalidDataException("The CyTask workspace exceeds the snapshot size limit. The previous checkpoint has been preserved.");
                await target.FlushAsync(cancellationToken);
            }
            string hash;
            await using (var source = File.OpenRead(temporary))
                hash = Convert.ToHexString(await SHA256.HashDataAsync(source, cancellationToken)).ToLowerInvariant();
            var path = Path.Combine(directory, $"{envelope.Sequence:D20}-{hash}.json");
            File.Move(temporary, path);
            var info = new FileInfo(path);
            _snapshotCache[path] = new(info.Length, info.LastWriteTimeUtc, envelope);
        }
        finally { if (File.Exists(temporary)) File.Delete(temporary); }
        long retainedBytes = 0;
        var index = 0;
        foreach (var file in Directory.EnumerateFiles(directory, "*.json")
                     .OrderByDescending(Path.GetFileName, StringComparer.Ordinal))
        {
            retainedBytes += new FileInfo(file).Length;
            if (index >= 50 || index >= 2 && retainedBytes > 256L * 1024 * 1024)
                File.Delete(file);
            index++;
        }
    }

    private async Task WriteConflictAsync(LocalSyncConflict conflict, CancellationToken cancellationToken)
    {
        var path = Path.Combine(_conflictsPath!, $"{conflict.Id}.json");
        if (!File.Exists(path)) await WriteJsonAsync(path, conflict, cancellationToken);
    }

    private async Task<T?> ReadJsonAsync<T>(string path, CancellationToken cancellationToken)
    {
        await using var stream = encryption.OpenFile(path, "workspace");
        return await JsonSerializer.DeserializeAsync<T>(stream, _json, cancellationToken);
    }

    private Task WriteJsonAsync<T>(string path, T value, CancellationToken cancellationToken) =>
        WriteBytesAsync(path, JsonSerializer.SerializeToUtf8Bytes(value, _json), cancellationToken);

    private async Task WriteBytesAsync(string path, byte[] bytes, CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
        try
        {
            await using (var target = encryption.CreateFile(temporary, "workspace"))
                await target.WriteAsync(bytes, cancellationToken);
            try { File.Move(temporary, path, false); }
            catch (IOException) when (File.Exists(path)) { File.Delete(temporary); }
        }
        finally { CryptographicOperations.ZeroMemory(bytes); File.Delete(temporary); }
    }

    private static string ValidateWorkspacePath(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured))
            throw new InvalidOperationException("CyTask:LocalWorkspacePath est requis en mode local.");
        var path = Path.GetFullPath(configured);
        var root = Path.GetPathRoot(path);
        if (string.Equals(path.TrimEnd(Path.DirectorySeparatorChar), root?.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("La racine d’un disque ne peut pas servir de dossier CyTask.");
        Directory.CreateDirectory(path);
        return path;
    }

    private static void WriteIgnoreFileIfMissing(string root)
    {
        const string marker = "// CyTask managed local-only data";
        const string rules = marker + "\n" +
            "(?d)/.cytask/runtime\n(?d)/.cytask/media/uploads\n" +
            "(?d)/.cytask/media/quarantine\n(?d)/.cytask/**/*.tmp\n";
        var path = Path.Combine(root, ".stignore");
        var existing = File.Exists(path) ? File.ReadAllText(path) : string.Empty;
        if (existing.Contains(marker, StringComparison.Ordinal)) return;
        if (existing.Length > 0 && !existing.EndsWith('\n')) existing += "\n";
        File.WriteAllText(path, existing + rules, new UTF8Encoding(false));
    }

    private string HashJson<T>(T value)
    {
        using var hash = SHA256.Create();
        using var sink = new CryptoStream(Stream.Null, hash, CryptoStreamMode.Write);
        JsonSerializer.Serialize(sink, value, _json);
        sink.FlushFinalBlock();
        return Convert.ToHexString(hash.Hash!).ToLowerInvariant();
    }
    private static int CompareDevice(Guid left, Guid right) =>
        string.CompareOrdinal(left.ToString("N"), right.ToString("N"));
    [LoggerMessage(1001, LogLevel.Error, "Impossible d’initialiser le mode local CyTask.")]
    private static partial void LogInitializationError(ILogger logger, Exception exception);

    [LoggerMessage(1002, LogLevel.Warning, "Une passe de synchronisation locale CyTask a échoué.")]
    private static partial void LogSynchronizationWarning(ILogger logger, Exception exception);

    [LoggerMessage(1003, LogLevel.Debug, "Snapshot local ignoré : {SnapshotPath}")]
    private static partial void LogIgnoredSnapshot(ILogger logger, string snapshotPath, Exception exception);

    private sealed record SnapshotState(LocalSyncPayload Payload, IReadOnlyList<LocalSyncTombstone> Tombstones);
    private sealed record Owned<T>(T Value, Guid DeviceId, string Hash);
    private sealed record CachedSnapshot(long Length, DateTime LastWrite, LocalSyncEnvelope Envelope);
}
