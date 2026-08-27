using System.Text.Json;

namespace CyTask.Api.Plugins;

public sealed class InMemoryCyAnnotaStore : ICyAnnotaStore
{
    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, CyAnnotaDocument> _documents = [];

    public Task<IReadOnlyList<CyAnnotaDocument>> ListTaskDocumentsAsync(
        Guid organizationId, Guid taskId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<CyAnnotaDocument> result = _documents.Values
                .Where(item => item.OrganizationId == organizationId && item.TaskId == taskId)
                .OrderByDescending(item => item.UpdatedAt)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<CyAnnotaDocument?> GetDocumentAsync(
        Guid organizationId, Guid taskId, Guid attachmentId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var item = _documents.GetValueOrDefault(attachmentId);
            return Task.FromResult(item?.OrganizationId == organizationId
                && item.TaskId == taskId ? item : null);
        }
    }

    public Task<CyAnnotaDocument?> UpsertDocumentAsync(
        Guid organizationId, Guid projectId, Guid taskId, Guid attachmentId,
        string mediaKind, JsonElement document, int annotationCount,
        long expectedRevision, Guid userId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var current = _documents.GetValueOrDefault(attachmentId);
            if ((current is null && expectedRevision != 0)
                || (current is not null && (current.OrganizationId != organizationId
                    || current.ProjectId != projectId || current.TaskId != taskId
                    || current.Revision != expectedRevision)))
            {
                return Task.FromResult<CyAnnotaDocument?>(null);
            }

            var updated = new CyAnnotaDocument(
                organizationId, projectId, taskId, attachmentId, mediaKind,
                document.Clone(), annotationCount, (current?.Revision ?? 0) + 1,
                userId, DateTimeOffset.UtcNow);
            _documents[attachmentId] = updated;
            return Task.FromResult<CyAnnotaDocument?>(updated);
        }
    }
}
