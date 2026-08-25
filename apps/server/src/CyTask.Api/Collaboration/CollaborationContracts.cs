namespace CyTask.Api.Collaboration;

public sealed record CreateProjectResourceRequest(
    string ResourceType,
    string Name,
    string? Body,
    Guid? FolderLabelId);

public sealed record UpdateProjectResourceRequest(
    string Name,
    string? Body,
    Guid? FolderLabelId,
    long ExpectedRevision);

public sealed record CreateProjectResourceUploadRequest(
    string FileName,
    string ContentType,
    long SizeBytes,
    string Sha256,
    Guid? FolderLabelId);

public sealed record CreateChatChannelRequest(
    string Name,
    string? Topic);

public sealed record CreateChatMessageRequest(
    string Body,
    IReadOnlyList<Guid>? ResourceIds,
    IReadOnlyList<Guid>? MentionedUserIds);
