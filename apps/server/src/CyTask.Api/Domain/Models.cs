namespace CyTask.Api.Domain;

public sealed record UserAccount(
    Guid Id,
    string Email,
    string DisplayName,
    string PasswordHash,
    DateTimeOffset CreatedAt);

public sealed record Organization(
    Guid Id,
    string Name,
    string Slug,
    DateTimeOffset CreatedAt);

public sealed record AuthenticatedUser(
    Guid UserId,
    Guid OrganizationId,
    string Email,
    string DisplayName,
    string Role,
    byte[] CsrfHash,
    DateTimeOffset SessionExpiresAt);

public sealed record Project(
    Guid Id,
    Guid OrganizationId,
    string Name,
    string Key,
    int NextTaskNumber,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record WorkItem(
    Guid Id,
    Guid OrganizationId,
    Guid ProjectId,
    int Number,
    string Key,
    string Title,
    string Description,
    string Status,
    string Priority,
    DateTimeOffset? DueAt,
    Guid? AssigneeId,
    string? AssigneeName,
    long Revision,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record Comment(
    Guid Id,
    Guid OrganizationId,
    Guid TaskId,
    Guid AuthorId,
    string AuthorName,
    string Body,
    DateTimeOffset CreatedAt);

public sealed record TaskChecklistItem(
    Guid Id,
    Guid OrganizationId,
    Guid TaskId,
    string Title,
    bool IsCompleted,
    int Position,
    long Revision,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record TaskDetails(
    WorkItem Task,
    IReadOnlyList<Comment> Comments,
    IReadOnlyList<TaskChecklistItem> Checklist);


public sealed record ProjectLabel(
    Guid Id,
    Guid OrganizationId,
    Guid ProjectId,
    string Name,
    string Color,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record TaskLabelAssignment(
    Guid TaskId,
    Guid LabelId,
    Guid AssignedBy,
    DateTimeOffset AssignedAt);

public sealed record ProjectLabelOverview(
    IReadOnlyList<ProjectLabel> Labels,
    IReadOnlyList<TaskLabelAssignment> Assignments);

public enum AddTaskLabelStatus
{
    Created,
    AlreadyExists,
    NotFound
}

public sealed record AddTaskLabelResult(
    AddTaskLabelStatus Status,
    TaskLabelAssignment? Assignment);

public sealed record OrganizationMember(
    Guid UserId,
    string Email,
    string DisplayName,
    string Role,
    DateTimeOffset JoinedAt);

public sealed record InvitationPreview(
    string OrganizationName,
    string Email,
    string Role,
    DateTimeOffset ExpiresAt);

public sealed record CreatedInvitation(
    Guid Id,
    string Email,
    string Role,
    string Token,
    DateTimeOffset ExpiresAt);

public sealed record ActivityEntry(
    Guid Id,
    Guid OrganizationId,
    string EventType,
    string AggregateType,
    Guid AggregateId,
    Guid? ActorId,
    string ActorName,
    string Summary,
    DateTimeOffset CreatedAt);

public sealed record SearchHit(
    string Type,
    Guid Id,
    string Key,
    string Title,
    string Excerpt,
    DateTimeOffset UpdatedAt);

public sealed record WorkspaceExport(
    int FormatVersion,
    DateTimeOffset ExportedAt,
    Organization Organization,
    IReadOnlyList<OrganizationMember> Members,
    IReadOnlyList<Project> Projects,
    IReadOnlyList<WorkItem> Tasks,
    IReadOnlyList<Comment> Comments,
    IReadOnlyList<TaskChecklistItem> Checklist,
    IReadOnlyList<ProjectLabel> ProjectLabels,
    IReadOnlyList<TaskLabelAssignment> TaskLabels,
    IReadOnlyList<ActivityEntry> Activity,
    IReadOnlyList<Attachment> Attachments);

public sealed record Attachment(
    Guid Id,
    Guid OrganizationId,
    Guid TaskId,
    string FileName,
    string DeclaredContentType,
    string? DetectedContentType,
    long SizeBytes,
    string Sha256,
    string Status,
    bool OptimizedLocally,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    string? RejectionReason = null,
    int? Width = null,
    int? Height = null,
    DateTimeOffset? ReviewedAt = null,
    double? DurationSeconds = null);

public sealed record PendingAttachmentReview(
    Guid Id,
    Guid OrganizationId,
    string DeclaredContentType,
    int Attempts);

public sealed record AttachmentReview(
    bool Accepted,
    string ContentType,
    int? Width,
    int? Height,
    string? RejectionReason,
    double? DurationSeconds = null);

public sealed record UploadChunk(
    int Index,
    long SizeBytes,
    string Sha256,
    DateTimeOffset CreatedAt);

public sealed record AttachmentUpload(
    Guid Id,
    Attachment Attachment,
    int ChunkSizeBytes,
    DateTimeOffset ExpiresAt,
    string Status,
    IReadOnlyList<UploadChunk> Chunks);

public enum RecordChunkStatus
{
    Recorded,
    AlreadyRecorded,
    NotFound,
    Conflict
}

public sealed record RecordChunkResult(RecordChunkStatus Status, UploadChunk? Chunk);

public sealed record ExternalReference(
    Guid Id,
    Guid OrganizationId,
    Guid TaskId,
    string Provider,
    string Repository,
    string ReferenceType,
    string ReferenceValue,
    string Label,
    string? WebUrl,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record TaskRelation(
    Guid Id,
    Guid ProjectId,
    string Key,
    string Title,
    string Status,
    DateTimeOffset LinkedAt);

public sealed record TaskDependencyOverview(
    IReadOnlyList<TaskRelation> DependsOn,
    IReadOnlyList<TaskRelation> Blocking);

public enum AddTaskDependencyStatus
{
    Created,
    AlreadyExists,
    NotFound,
    SelfDependency,
    Cycle
}

public sealed record AddTaskDependencyResult(AddTaskDependencyStatus Status, TaskRelation? Dependency);

public enum UpdateTaskStatus
{
    Updated,
    NotFound,
    RevisionConflict
}

public sealed record UpdateTaskResult(UpdateTaskStatus Status, WorkItem? Task);

public enum UpdateChecklistItemStatus
{
    Updated,
    NotFound,
    RevisionConflict
}

public sealed record UpdateChecklistItemResult(
    UpdateChecklistItemStatus Status,
    TaskChecklistItem? Item);

public sealed record ApiToken(
    Guid Id,
    string Name,
    string Scopes,
    DateTimeOffset CreatedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset? LastUsedAt,
    DateTimeOffset? RevokedAt);

public sealed record CreatedApiToken(ApiToken Token, string Secret);

public sealed record ApiTokenPrincipal(AuthenticatedUser User, string Scopes);

public sealed record BootstrapResult(
    AuthenticatedUser User,
    string SessionToken,
    string CsrfToken,
    Organization Organization);

public sealed record LoginResult(
    AuthenticatedUser User,
    string SessionToken,
    string CsrfToken);
