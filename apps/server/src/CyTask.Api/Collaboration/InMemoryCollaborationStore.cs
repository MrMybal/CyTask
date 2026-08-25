using CyTask.Api.Infrastructure;

namespace CyTask.Api.Collaboration;

public sealed class InMemoryCollaborationStore(IWorkspaceStore workspace) : ICollaborationStore
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, ProjectResource> _resources = [];
    private readonly Dictionary<Guid, ProjectResourceUpload> _uploads = [];
    private readonly Dictionary<Guid, ChatChannel> _channels = [];
    private readonly Dictionary<Guid, ChatMessage> _messages = [];

    public async Task<IReadOnlyList<ProjectResource>?> ListResourcesAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(organizationId, projectId, cancellationToken)) return null;
        lock (_gate)
        {
            return _resources.Values
                .Where(item => item.OrganizationId == organizationId && item.ProjectId == projectId)
                .OrderByDescending(item => item.UpdatedAt)
                .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
    }

    public Task<ProjectResource?> GetResourceAsync(
        Guid organizationId, Guid resourceId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            return Task.FromResult(_resources.TryGetValue(resourceId, out var resource)
                && resource.OrganizationId == organizationId ? resource : null);
        }
    }

    public async Task<ProjectResource?> CreateResourceAsync(
        Guid organizationId,
        Guid projectId,
        Guid? folderLabelId,
        string resourceType,
        string name,
        string body,
        Guid createdBy,
        CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(organizationId, projectId, cancellationToken)
            || !await FolderExistsAsync(organizationId, projectId, folderLabelId, cancellationToken))
        {
            return null;
        }

        var creator = await MemberNameAsync(organizationId, createdBy, cancellationToken);
        if (creator is null) return null;
        var now = DateTimeOffset.UtcNow;
        var resource = new ProjectResource(
            Guid.CreateVersion7(), organizationId, projectId, folderLabelId, resourceType,
            name, body, null, null, 0, null, "ready", null, 1, createdBy, creator, now, now);
        lock (_gate) _resources.Add(resource.Id, resource);
        return resource;
    }

    public async Task<ResourceUpdateResult> UpdateResourceAsync(
        Guid organizationId,
        Guid resourceId,
        Guid? folderLabelId,
        string name,
        string body,
        long expectedRevision,
        CancellationToken cancellationToken)
    {
        ProjectResource? current;
        lock (_gate)
        {
            current = _resources.GetValueOrDefault(resourceId);
            if (current is null || current.OrganizationId != organizationId)
                return new(ResourceUpdateStatus.NotFound, null);
            if (current.Revision != expectedRevision)
                return new(ResourceUpdateStatus.RevisionConflict, current);
        }
        if (!await FolderExistsAsync(
                organizationId, current.ProjectId, folderLabelId, cancellationToken))
            return new(ResourceUpdateStatus.NotFound, null);

        var updated = current with
        {
            FolderLabelId = folderLabelId,
            Name = name,
            Body = body,
            Revision = current.Revision + 1,
            UpdatedAt = DateTimeOffset.UtcNow
        };
        lock (_gate)
        {
            var latest = _resources.GetValueOrDefault(resourceId);
            if (latest?.Revision != expectedRevision)
                return new(ResourceUpdateStatus.RevisionConflict, latest);
            _resources[resourceId] = updated;
        }
        return new(ResourceUpdateStatus.Updated, updated);
    }

    public async Task<ProjectResourceUpload?> CreateResourceUploadAsync(
        CreateResourceUploadData data,
        CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(data.OrganizationId, data.ProjectId, cancellationToken)
            || !await FolderExistsAsync(
                data.OrganizationId, data.ProjectId, data.FolderLabelId, cancellationToken))
            return null;
        var creator = await MemberNameAsync(data.OrganizationId, data.CreatedBy, cancellationToken);
        if (creator is null) return null;

        var now = DateTimeOffset.UtcNow;
        var resource = new ProjectResource(
            Guid.CreateVersion7(), data.OrganizationId, data.ProjectId, data.FolderLabelId, "file",
            data.FileName, "", data.ContentType, null, data.SizeBytes, data.Sha256, "uploading", null,
            1, data.CreatedBy, creator, now, now);
        var upload = new ProjectResourceUpload(
            Guid.CreateVersion7(), resource, data.ChunkSizeBytes, data.ExpiresAt, "active", []);
        lock (_gate)
        {
            _resources.Add(resource.Id, resource);
            _uploads.Add(upload.Id, upload);
        }
        return upload;
    }

    public Task<ProjectResourceUpload?> GetResourceUploadAsync(
        Guid organizationId, Guid uploadId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var upload = _uploads.GetValueOrDefault(uploadId);
            return Task.FromResult(upload?.Resource.OrganizationId == organizationId ? upload : null);
        }
    }

    public Task<ResourceChunkResult> RecordResourceChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        long sizeBytes,
        string sha256,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var upload = _uploads.GetValueOrDefault(uploadId);
            if (upload is null || upload.Resource.OrganizationId != organizationId
                || upload.Status != "active" || upload.ExpiresAt <= DateTimeOffset.UtcNow)
                return Task.FromResult(new ResourceChunkResult(ResourceChunkStatus.NotFound, null));
            var existing = upload.Chunks.FirstOrDefault(chunk => chunk.Index == index);
            if (existing is not null)
            {
                var status = existing.SizeBytes == sizeBytes && existing.Sha256 == sha256
                    ? ResourceChunkStatus.AlreadyRecorded
                    : ResourceChunkStatus.Conflict;
                return Task.FromResult(new ResourceChunkResult(status, existing));
            }
            var chunk = new ResourceUploadChunk(index, sizeBytes, sha256, DateTimeOffset.UtcNow);
            _uploads[uploadId] = upload with
            {
                Chunks = upload.Chunks.Append(chunk).OrderBy(item => item.Index).ToArray()
            };
            return Task.FromResult(new ResourceChunkResult(ResourceChunkStatus.Recorded, chunk));
        }
    }

    public Task<ProjectResource?> CompleteResourceUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string detectedContentType,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var upload = _uploads.GetValueOrDefault(uploadId);
            if (upload is null || upload.Resource.OrganizationId != organizationId
                || upload.Status != "active") return Task.FromResult<ProjectResource?>(null);
            var resource = upload.Resource with
            {
                Status = "available",
                DetectedContentType = detectedContentType,
                Revision = upload.Resource.Revision + 1,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            _resources[resource.Id] = resource;
            _uploads[uploadId] = upload with { Resource = resource, Status = "completed" };
            return Task.FromResult<ProjectResource?>(resource);
        }
    }

    public Task RejectResourceUploadAsync(
        Guid organizationId, Guid uploadId, string reason, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var upload = _uploads.GetValueOrDefault(uploadId);
            if (upload is null || upload.Resource.OrganizationId != organizationId) return Task.CompletedTask;
            var resource = upload.Resource with
            {
                Status = "rejected", RejectionReason = reason,
                Revision = upload.Resource.Revision + 1, UpdatedAt = DateTimeOffset.UtcNow
            };
            _resources[resource.Id] = resource;
            _uploads[uploadId] = upload with { Resource = resource, Status = "rejected" };
        }
        return Task.CompletedTask;
    }

    public async Task<IReadOnlyList<ChatChannel>?> ListChannelsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(organizationId, projectId, cancellationToken)) return null;
        lock (_gate)
        {
            return _channels.Values
                .Where(item => item.OrganizationId == organizationId && item.ProjectId == projectId)
                .OrderBy(item => item.CreatedAt).ToArray();
        }
    }

    public Task<ChatChannel?> GetChannelAsync(
        Guid organizationId, Guid channelId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var channel = _channels.GetValueOrDefault(channelId);
            return Task.FromResult(channel?.OrganizationId == organizationId ? channel : null);
        }
    }

    public async Task<ChatChannel?> CreateChannelAsync(
        Guid organizationId,
        Guid projectId,
        string name,
        string slug,
        string topic,
        Guid createdBy,
        CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(organizationId, projectId, cancellationToken)) return null;
        lock (_gate)
        {
            var existing = _channels.Values.FirstOrDefault(item =>
                item.ProjectId == projectId && item.Slug == slug);
            if (existing is not null) return existing;
            var channel = new ChatChannel(
                Guid.CreateVersion7(), organizationId, projectId, name, slug, topic,
                createdBy, DateTimeOffset.UtcNow);
            _channels.Add(channel.Id, channel);
            return channel;
        }
    }

    public Task<IReadOnlyList<ChatMessage>?> ListMessagesAsync(
        Guid organizationId,
        Guid channelId,
        int limit,
        DateTimeOffset? before,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (_gate)
        {
            var channel = _channels.GetValueOrDefault(channelId);
            if (channel?.OrganizationId != organizationId)
                return Task.FromResult<IReadOnlyList<ChatMessage>?>(null);
            IReadOnlyList<ChatMessage> result = _messages.Values
                .Where(item => item.ChannelId == channelId && (before is null || item.CreatedAt < before))
                .OrderByDescending(item => item.CreatedAt).Take(limit).OrderBy(item => item.CreatedAt).ToArray();
            return Task.FromResult<IReadOnlyList<ChatMessage>?>(result);
        }
    }

    public async Task<ChatMessage?> CreateMessageAsync(
        Guid organizationId,
        Guid channelId,
        Guid authorId,
        string body,
        IReadOnlyList<Guid> resourceIds,
        IReadOnlyList<Guid> mentionedUserIds,
        CancellationToken cancellationToken)
    {
        var authorName = await MemberNameAsync(organizationId, authorId, cancellationToken);
        var members = await workspace.ListMembersAsync(organizationId, cancellationToken);
        lock (_gate)
        {
            var channel = _channels.GetValueOrDefault(channelId);
            if (channel?.OrganizationId != organizationId || authorName is null) return null;
            var resources = resourceIds.Distinct().Select(id => _resources.GetValueOrDefault(id)).ToArray();
            if (resources.Any(item => item is null || item.OrganizationId != organizationId
                || item.ProjectId != channel.ProjectId)) return null;
            var validMemberIds = members.Select(item => item.UserId).ToHashSet();
            var mentions = mentionedUserIds.Distinct().Where(validMemberIds.Contains).ToArray();
            var message = new ChatMessage(
                Guid.CreateVersion7(), organizationId, channelId, authorId, authorName, body,
                DateTimeOffset.UtcNow, null, resources.Select(item => item!).ToArray(), mentions);
            _messages.Add(message.Id, message);
            return message;
        }
    }

    private async Task<bool> ProjectExistsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken) =>
        (await workspace.ListProjectsAsync(organizationId, cancellationToken))
            .Any(project => project.Id == projectId);

    private async Task<bool> FolderExistsAsync(
        Guid organizationId,
        Guid projectId,
        Guid? folderId,
        CancellationToken cancellationToken)
    {
        if (folderId is null) return true;
        var overview = await workspace.GetProjectLabelsAsync(
            organizationId, projectId, cancellationToken);
        return overview?.Labels.Any(label => label.Id == folderId) == true;
    }

    private async Task<string?> MemberNameAsync(
        Guid organizationId, Guid userId, CancellationToken cancellationToken) =>
        (await workspace.ListMembersAsync(organizationId, cancellationToken))
            .FirstOrDefault(member => member.UserId == userId)?.DisplayName;
}
