namespace CyTask.Api.Collaboration;

public sealed record ProjectResource(
    Guid Id,
    Guid OrganizationId,
    Guid ProjectId,
    Guid? FolderLabelId,
    string ResourceType,
    string Name,
    string Body,
    string? DeclaredContentType,
    string? DetectedContentType,
    long SizeBytes,
    string? Sha256,
    string Status,
    string? RejectionReason,
    long Revision,
    Guid CreatedBy,
    string CreatedByName,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record ResourceUploadChunk(
    int Index,
    long SizeBytes,
    string Sha256,
    DateTimeOffset CreatedAt);

public sealed record ProjectResourceUpload(
    Guid Id,
    ProjectResource Resource,
    int ChunkSizeBytes,
    DateTimeOffset ExpiresAt,
    string Status,
    IReadOnlyList<ResourceUploadChunk> Chunks);

public enum ResourceChunkStatus
{
    Recorded,
    AlreadyRecorded,
    NotFound,
    Conflict
}

public sealed record ResourceChunkResult(ResourceChunkStatus Status, ResourceUploadChunk? Chunk);

public enum ResourceUpdateStatus
{
    Updated,
    NotFound,
    RevisionConflict
}

public sealed record ResourceUpdateResult(ResourceUpdateStatus Status, ProjectResource? Resource);

public sealed record ChatChannel(
    Guid Id,
    Guid OrganizationId,
    Guid ProjectId,
    string Name,
    string Slug,
    string Topic,
    string ChannelType,
    IReadOnlyList<Guid> MemberIds,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record ChatMessage(
    Guid Id,
    Guid OrganizationId,
    Guid ChannelId,
    Guid AuthorId,
    string AuthorName,
    string Body,
    DateTimeOffset CreatedAt,
    DateTimeOffset? EditedAt,
    IReadOnlyList<ProjectResource> Resources,
    IReadOnlyList<Guid> MentionedUserIds);

public sealed record CreateResourceUploadData(
    Guid OrganizationId,
    Guid ProjectId,
    Guid? FolderLabelId,
    Guid CreatedBy,
    string FileName,
    string ContentType,
    long SizeBytes,
    string Sha256,
    int ChunkSizeBytes,
    DateTimeOffset ExpiresAt);

public sealed record CompleteResourceData(
    string DetectedContentType,
    int? Width,
    int? Height,
    double? DurationSeconds);
