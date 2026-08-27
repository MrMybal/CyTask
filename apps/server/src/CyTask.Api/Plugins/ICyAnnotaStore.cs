using System.Text.Json;

namespace CyTask.Api.Plugins;

public interface ICyAnnotaStore
{
    Task<IReadOnlyList<CyAnnotaDocument>> ListTaskDocumentsAsync(
        Guid organizationId, Guid taskId, CancellationToken cancellationToken);

    Task<CyAnnotaDocument?> GetDocumentAsync(
        Guid organizationId, Guid taskId, Guid attachmentId,
        CancellationToken cancellationToken);

    Task<CyAnnotaDocument?> UpsertDocumentAsync(
        Guid organizationId, Guid projectId, Guid taskId, Guid attachmentId,
        string mediaKind, JsonElement document, int annotationCount,
        long expectedRevision, Guid userId, CancellationToken cancellationToken);
}
