namespace CyTask.Api.Migrations;

public sealed record MigrationAnalyzeRequest(
    string Source,
    Guid TargetProjectId,
    string ApiToken,
    string ContainerId,
    string? SiteUrl = null,
    string? AccountEmail = null,
    bool IncludeCompleted = true,
    bool IncludeComments = true,
    int MaxItems = 500);

public sealed record MigrationImportRequest(
    IReadOnlyList<MigrationStatusMapping> StatusMappings,
    IReadOnlyList<MigrationAssigneeMapping> AssigneeMappings,
    bool ImportComments = true,
    bool ImportChecklists = true,
    bool CreateLabels = true,
    bool LinkParents = true,
    bool LinkDependencies = true);

public sealed record MigrationStatusMapping(string SourceStatus, string TargetStatus);
public sealed record MigrationAssigneeMapping(string SourceIdentity, Guid? TargetUserId);

public sealed record MigrationPreview(
    Guid Id,
    string Source,
    string SourceName,
    string SourceInstance,
    Guid TargetProjectId,
    DateTimeOffset ExpiresAt,
    MigrationSummary Summary,
    IReadOnlyList<MigrationSourceStatus> Statuses,
    IReadOnlyList<MigrationSourceAssignee> Assignees,
    IReadOnlyList<MigrationPreviewItem> Items,
    IReadOnlyList<string> Warnings);

public sealed record MigrationSummary(
    int Tasks,
    int Comments,
    int ChecklistItems,
    int Attachments,
    int ParentRelations,
    int Dependencies);

public sealed record MigrationSourceStatus(
    string Name,
    string Color,
    int TaskCount,
    string SuggestedTargetStatus);

public sealed record MigrationSourceAssignee(
    string Identity,
    string DisplayName,
    string? Email,
    int TaskCount,
    Guid? SuggestedMemberId);

public sealed record MigrationPreviewItem(
    string SourceId,
    string SourceKey,
    string Title,
    string Status,
    string Priority,
    DateTimeOffset? SourceCreatedAt,
    DateTimeOffset? SourceUpdatedAt,
    DateTimeOffset? DueAt,
    IReadOnlyList<string> Assignees,
    int CommentCount,
    int ChecklistCount,
    int AttachmentCount,
    bool HasParent,
    int DependencyCount);

public sealed record MigrationImportResult(
    Guid PreviewId,
    string Source,
    string SourceName,
    Guid TargetProjectId,
    int Created,
    int Skipped,
    int Failed,
    int CommentsCreated,
    int ChecklistItemsCreated,
    int LabelsCreated,
    int ParentRelationsCreated,
    int DependenciesCreated,
    IReadOnlyList<MigrationImportedItem> Items,
    IReadOnlyList<string> Warnings,
    DateTimeOffset CompletedAt);

public sealed record MigrationImportedItem(
    string SourceId,
    string SourceKey,
    Guid? TaskId,
    string? TaskKey,
    string Outcome,
    string? Message);

internal sealed record NormalizedMigration(
    string Source,
    string SourceName,
    string SourceInstance,
    IReadOnlyList<NormalizedMigrationItem> Items,
    IReadOnlyList<string> Warnings);

internal sealed record NormalizedMigrationItem(
    string SourceId,
    string SourceKey,
    string? SourceUrl,
    string Title,
    string Description,
    string Status,
    string StatusColor,
    string Priority,
    DateTimeOffset? SourceCreatedAt,
    DateTimeOffset? SourceUpdatedAt,
    DateTimeOffset? DueAt,
    IReadOnlyList<NormalizedMigrationPerson> Assignees,
    string? ParentSourceId,
    IReadOnlyList<NormalizedMigrationLabel> Labels,
    IReadOnlyList<NormalizedMigrationChecklistItem> Checklist,
    IReadOnlyList<NormalizedMigrationComment> Comments,
    IReadOnlyList<NormalizedMigrationAttachment> Attachments,
    IReadOnlyList<string> DependsOnSourceIds);

internal sealed record NormalizedMigrationPerson(
    string Identity,
    string DisplayName,
    string? Email);

internal sealed record NormalizedMigrationLabel(string Name, string Color);
internal sealed record NormalizedMigrationChecklistItem(string Title, bool IsCompleted);
internal sealed record NormalizedMigrationComment(string Author, DateTimeOffset? CreatedAt, string Body);
internal sealed record NormalizedMigrationAttachment(string Name, string? ContentType, string Url);
