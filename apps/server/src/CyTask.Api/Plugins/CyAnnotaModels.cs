using System.Text.Json;

namespace CyTask.Api.Plugins;

public sealed record CyAnnotaDocument(
    Guid OrganizationId,
    Guid ProjectId,
    Guid TaskId,
    Guid AttachmentId,
    string MediaKind,
    JsonElement Document,
    int AnnotationCount,
    long Revision,
    Guid UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record CyAnnotaDocumentSummary(
    Guid AttachmentId,
    string MediaKind,
    int AnnotationCount,
    long Revision,
    DateTimeOffset UpdatedAt);

public sealed record CyAnnotaWorkspaceView(
    string ApplicationUrl,
    int MaximumDocumentBytes,
    IReadOnlyList<CyAnnotaDocumentSummary> Documents);

public sealed record CyAnnotaDocumentView(
    Guid AttachmentId,
    string MediaKind,
    JsonElement? Document,
    int AnnotationCount,
    long Revision,
    DateTimeOffset? UpdatedAt);

public sealed record UpdateCyAnnotaDocumentRequest(
    JsonElement Document,
    long ExpectedRevision);
