using System.Text;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using Microsoft.Net.Http.Headers;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task<IResult> ListResourcesAsync(
        Guid projectId, HttpContext context, ICollaborationStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var resources = await store.ListResourcesAsync(
            user.OrganizationId, projectId, cancellationToken);
        return resources is null ? Results.NotFound() : Results.Ok(resources);
    }

    private static async Task<IResult> GetResourceAsync(
        Guid resourceId, HttpContext context, ICollaborationStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var resource = await store.GetResourceAsync(
            user.OrganizationId, resourceId, cancellationToken);
        return resource is null ? Results.NotFound() : Results.Ok(resource);
    }

    private static async Task<IResult> CreateResourceAsync(
        Guid projectId, CreateProjectResourceRequest request, HttpContext context,
        ICollaborationStore store, WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var type = request.ResourceType.Trim().ToLowerInvariant();
        var name = request.Name.Trim().Normalize(NormalizationForm.FormC);
        var body = request.Body ?? string.Empty;
        var errors = new Dictionary<string, string[]>();
        if (type is not ("document" or "canvas"))
            errors[nameof(request.ResourceType)] = ["Le type doit être document ou canvas."];
        if (name.Length is < 1 or > 240 || name.Any(char.IsControl))
            errors[nameof(request.Name)] = ["Le nom doit contenir entre 1 et 240 caractères."];
        if (Encoding.UTF8.GetByteCount(body) > 2_097_152)
            errors[nameof(request.Body)] = ["Le contenu ne peut pas dépasser 2 Mio."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var user = context.GetUser()!;
        var resource = await store.CreateResourceAsync(
            user.OrganizationId, projectId, request.FolderLabelId, type, name, body,
            user.UserId, cancellationToken);
        if (resource is null) return Results.NotFound();
        events.Publish(user.OrganizationId, "project.resource_created", resource.Id);
        return Results.Created($"/api/v1/resources/{resource.Id}", resource);
    }

    private static async Task<IResult> UpdateResourceAsync(
        Guid resourceId, UpdateProjectResourceRequest request, HttpContext context,
        ICollaborationStore store, WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var name = request.Name.Trim().Normalize(NormalizationForm.FormC);
        var body = request.Body ?? string.Empty;
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 240 || name.Any(char.IsControl))
            errors[nameof(request.Name)] = ["Le nom doit contenir entre 1 et 240 caractères."];
        if (Encoding.UTF8.GetByteCount(body) > 2_097_152)
            errors[nameof(request.Body)] = ["Le contenu ne peut pas dépasser 2 Mio."];
        if (request.ExpectedRevision < 1)
            errors[nameof(request.ExpectedRevision)] = ["La révision attendue doit être positive."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var user = context.GetUser()!;
        var current = await store.GetResourceAsync(
            user.OrganizationId, resourceId, cancellationToken);
        if (current is null || current.ResourceType == "file") return Results.NotFound();
        var result = await store.UpdateResourceAsync(
            user.OrganizationId, resourceId, request.FolderLabelId, name, body,
            request.ExpectedRevision, cancellationToken);
        if (result.Status == ResourceUpdateStatus.NotFound) return Results.NotFound();
        if (result.Status == ResourceUpdateStatus.RevisionConflict)
            return Results.Json(new { title = "Le contenu a été modifié ailleurs.", resource = result.Resource },
                statusCode: StatusCodes.Status409Conflict);
        events.Publish(user.OrganizationId, "project.resource_updated", resourceId);
        return Results.Ok(result.Resource);
    }

    private static async Task<IResult> DownloadResourceAsync(
        Guid resourceId, HttpContext context, ICollaborationStore store,
        LocalMediaStorage storage, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var resource = await store.GetResourceAsync(
            user.OrganizationId, resourceId, cancellationToken);
        if (resource is null || resource.ResourceType != "file" || resource.Status != "available")
            return Results.NotFound();
        var content = storage.OpenObject(user.OrganizationId, resourceId);
        if (content is null) return Results.NotFound();
        context.Response.Headers.CacheControl = "private, max-age=300, no-transform";
        return Results.File(content, SafeContentType(resource.DetectedContentType), resource.Name,
            resource.UpdatedAt, new EntityTagHeaderValue($"\"{resource.Sha256}\""),
            enableRangeProcessing: true);
    }
}
