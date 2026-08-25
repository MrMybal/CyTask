namespace CyTask.Api.Collaboration;

public interface ICollaborationStore
{
    Task<IReadOnlyList<ProjectResource>?> ListResourcesAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken);

    Task<ProjectResource?> GetResourceAsync(
        Guid organizationId, Guid resourceId, CancellationToken cancellationToken);

    Task<ProjectResource?> CreateResourceAsync(
        Guid organizationId,
        Guid projectId,
        Guid? folderLabelId,
        string resourceType,
        string name,
        string body,
        Guid createdBy,
        CancellationToken cancellationToken);

    Task<ResourceUpdateResult> UpdateResourceAsync(
        Guid organizationId,
        Guid resourceId,
        Guid? folderLabelId,
        string name,
        string body,
        long expectedRevision,
        CancellationToken cancellationToken);

    Task<ProjectResourceUpload?> CreateResourceUploadAsync(
        CreateResourceUploadData data,
        CancellationToken cancellationToken);

    Task<ProjectResourceUpload?> GetResourceUploadAsync(
        Guid organizationId, Guid uploadId, CancellationToken cancellationToken);

    Task<ResourceChunkResult> RecordResourceChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        long sizeBytes,
        string sha256,
        CancellationToken cancellationToken);

    Task<ProjectResource?> CompleteResourceUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string detectedContentType,
        CancellationToken cancellationToken);

    Task RejectResourceUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string reason,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ChatChannel>?> ListChannelsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken);

    Task<ChatChannel?> GetChannelAsync(
        Guid organizationId, Guid channelId, CancellationToken cancellationToken);

    Task<ChatChannel?> CreateChannelAsync(
        Guid organizationId,
        Guid projectId,
        string name,
        string slug,
        string topic,
        Guid createdBy,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ChatMessage>?> ListMessagesAsync(
        Guid organizationId,
        Guid channelId,
        int limit,
        DateTimeOffset? before,
        CancellationToken cancellationToken);

    Task<ChatMessage?> CreateMessageAsync(
        Guid organizationId,
        Guid channelId,
        Guid authorId,
        string body,
        IReadOnlyList<Guid> resourceIds,
        IReadOnlyList<Guid> mentionedUserIds,
        CancellationToken cancellationToken);
}
