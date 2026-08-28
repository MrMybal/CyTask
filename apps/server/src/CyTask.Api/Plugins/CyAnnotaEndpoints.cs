using System.Text.Json;
using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Plugins;

public static class CyAnnotaEndpoints
{
    public const int MaximumDocumentBytes = 4_194_304;
    private const int MaximumAnnotations = 5_000;

    public static RouteGroupBuilder MapCyAnnotaEndpoints(this RouteGroupBuilder authenticated)
    {
        authenticated.MapGet(
            "/tasks/{taskId:guid}/plugins/cyannota/workspace", GetWorkspaceAsync);
        authenticated.MapGet(
            "/tasks/{taskId:guid}/plugins/cyannota/media/{attachmentId:guid}",
            GetDocumentAsync);
        authenticated.MapPut(
                "/tasks/{taskId:guid}/plugins/cyannota/media/{attachmentId:guid}",
                UpdateDocumentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"))
            .RequireRateLimiting("uploads");
        return authenticated;
    }

    private static async Task<IResult> GetWorkspaceAsync(
        Guid taskId,
        HttpContext context,
        IPluginStore plugins,
        ICyAnnotaStore annotations,
        IWorkspaceStore workspace,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var access = await ResolveTaskAsync(taskId, context, plugins, workspace, cancellationToken);
        if (access.Error is not null) return access.Error;

        var documents = await annotations.ListTaskDocumentsAsync(
            context.GetUser()!.OrganizationId, taskId, cancellationToken);
        return Results.Ok(new CyAnnotaWorkspaceView(
            options.Value.CyAnnotaUrl.Trim(),
            MaximumDocumentBytes,
            documents.Select(ToSummary).ToArray()));
    }

    private static async Task<IResult> GetDocumentAsync(
        Guid taskId,
        Guid attachmentId,
        HttpContext context,
        IPluginStore plugins,
        ICyAnnotaStore annotations,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var access = await ResolveAttachmentAsync(
            taskId, attachmentId, context, plugins, workspace, cancellationToken);
        if (access.Error is not null) return access.Error;

        var existing = await annotations.GetDocumentAsync(
            context.GetUser()!.OrganizationId, taskId, attachmentId, cancellationToken);
        return Results.Ok(existing is null
            ? new CyAnnotaDocumentView(
                attachmentId, access.MediaKind!, null, 0, 0, null)
            : ToView(existing));
    }

    private static async Task<IResult> UpdateDocumentAsync(
        Guid taskId,
        Guid attachmentId,
        UpdateCyAnnotaDocumentRequest request,
        HttpContext context,
        IPluginStore plugins,
        ICyAnnotaStore annotations,
        IWorkspaceStore workspace,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        if (request.ExpectedRevision < 0)
        {
            return Validation("expectedRevision", "La révision attendue ne peut pas être négative.");
        }

        var access = await ResolveAttachmentAsync(
            taskId, attachmentId, context, plugins, workspace, cancellationToken);
        if (access.Error is not null) return access.Error;

        var validation = ValidateDocument(request.Document, access.MediaKind!, attachmentId);
        if (validation.Error is not null) return validation.Error;

        var user = context.GetUser()!;
        var updated = await annotations.UpsertDocumentAsync(
            user.OrganizationId,
            access.ProjectId!.Value,
            taskId,
            attachmentId,
            access.MediaKind!,
            request.Document,
            validation.AnnotationCount,
            request.ExpectedRevision,
            user.UserId,
            cancellationToken);
        if (updated is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Les annotations ont été modifiées. Rechargez le média avant de sauver.");
        }

        events.Publish(user.OrganizationId, "task.cyannota_updated", taskId);
        return Results.Ok(ToView(updated));
    }

    private static async Task<AccessResult> ResolveTaskAsync(
        Guid taskId,
        HttpContext context,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var task = await workspace.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (task is null) return new(Results.NotFound(), null, null);

        var enabled = (await plugins.ListProjectPluginsAsync(
                user.OrganizationId, task.Task.ProjectId, cancellationToken))
            .Any(item => item.Enabled && string.Equals(
                item.PluginId, PluginCatalog.CyAnnotaPluginId, StringComparison.Ordinal));
        return enabled
            ? new(null, task.Task.ProjectId, null)
            : new(Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Le plugin CyAnnota n’est pas activé pour ce projet."), null, null);
    }

    private static async Task<AccessResult> ResolveAttachmentAsync(
        Guid taskId,
        Guid attachmentId,
        HttpContext context,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var taskAccess = await ResolveTaskAsync(
            taskId, context, plugins, workspace, cancellationToken);
        if (taskAccess.Error is not null) return taskAccess;

        var user = context.GetUser()!;
        var attachment = await workspace.FindAttachmentAsync(
            user.OrganizationId, attachmentId, cancellationToken);
        if (attachment is null || attachment.TaskId != taskId || attachment.Status != "available")
        {
            return new(Results.NotFound(), null, null);
        }

        var contentType = attachment.DetectedContentType ?? attachment.DeclaredContentType;
        var mediaKind = contentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase)
            ? "image"
            : contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? "video" : null;
        return mediaKind is null
            ? new(Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["attachmentId"] = ["Seules les images et vidéos validées peuvent être annotées."]
            }), null, null)
            : new(null, taskAccess.ProjectId, mediaKind);
    }

    private static ValidationResult ValidateDocument(
        JsonElement document, string mediaKind, Guid attachmentId)
    {
        if (document.ValueKind != JsonValueKind.Object)
        {
            return new(Validation("document", "Le document CyAnnota doit être un objet JSON."), 0);
        }

        if (JsonSerializer.SerializeToUtf8Bytes(document).Length > MaximumDocumentBytes)
        {
            return new(Validation("document", "Le document CyAnnota dépasse 4 Mio."), 0);
        }

        if (!document.TryGetProperty("version", out var version)
            || version.ValueKind != JsonValueKind.Number
            || !version.TryGetInt32(out var versionNumber)
            || versionNumber != 1)
        {
            return new(Validation("document.version", "La version CyAnnota doit être 1."), 0);
        }

        if (!document.TryGetProperty("annotations", out var annotations)
            || annotations.ValueKind != JsonValueKind.Array)
        {
            return new(Validation("document.annotations", "La liste des annotations est obligatoire."), 0);
        }

        var annotationCount = annotations.GetArrayLength();
        if (annotationCount > MaximumAnnotations)
        {
            return new(Validation("document.annotations", "Un média ne peut pas dépasser 5 000 annotations."), 0);
        }

        var declaresVideo = document.TryGetProperty("kind", out var kind)
            && kind.ValueKind == JsonValueKind.String
            && string.Equals(kind.GetString(), "video", StringComparison.Ordinal);
        if ((mediaKind == "video") != declaresVideo)
        {
            return new(Validation("document.kind", "Le type du document ne correspond pas au média."), 0);
        }

        if (mediaKind == "image" && document.TryGetProperty("image", out var image)
            && image.ValueKind == JsonValueKind.Object
            && image.TryGetProperty("src", out var source)
            && source.ValueKind == JsonValueKind.String)
        {
            var expected = $"cytask-attachment:{attachmentId:D}";
            var value = source.GetString() ?? string.Empty;
            if (value.Length > 0 && !string.Equals(value, expected, StringComparison.Ordinal))
            {
                return new(Validation(
                    "document.image.src",
                    "Le média source doit rester dans CyTask et ne peut pas être intégré au document."), 0);
            }
        }

        return new(null, annotationCount);
    }

    private static CyAnnotaDocumentSummary ToSummary(CyAnnotaDocument item) => new(
        item.AttachmentId, item.MediaKind, item.AnnotationCount,
        item.Revision, item.UpdatedAt);

    private static CyAnnotaDocumentView ToView(CyAnnotaDocument item) => new(
        item.AttachmentId, item.MediaKind, item.Document, item.AnnotationCount,
        item.Revision, item.UpdatedAt);

    private static IResult Validation(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    private sealed record AccessResult(IResult? Error, Guid? ProjectId, string? MediaKind);
    private sealed record ValidationResult(IResult? Error, int AnnotationCount);
}
