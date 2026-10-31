using System.Text.Json;
using CyTask.Api.Collaboration;
using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using CyTask.Api.Spaces;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Plugins;

public sealed record UpdateContentPluginRequest(JsonElement Data, long ExpectedRevision);
public static class ContentPluginEndpoints
{
    public static RouteGroupBuilder MapContentPluginEndpoints(this RouteGroupBuilder authenticated)
    {
        const string route = "/projects/{projectId:guid}/content/{contentKind}/{contentId:guid}/plugins/{pluginId}/{actionId}";
        authenticated.MapGet(route, ReadAsync);
        authenticated.MapPut(route, WriteAsync).AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member")).RequireRateLimiting("uploads");
        return authenticated;
    }
    private static async Task<IResult> ReadAsync(Guid projectId, string contentKind, Guid contentId, string pluginId, string actionId,
        HttpContext context, PluginCatalog catalog, IPluginStore plugins, IContentPluginStore data,
        IWorkspaceStore workspace, ICollaborationStore collaboration, IOptions<CyTaskOptions> options, CancellationToken cancellationToken)
    {
        var target = await ResolveAsync(projectId, contentKind, contentId, context, workspace, collaboration, cancellationToken);
        if (target is null) return Results.NotFound();
        var action = await ActionAsync(projectId, pluginId, actionId, target.Surface, context, catalog, plugins, cancellationToken);
        if (action is null) return Results.NotFound();
        var stored = await data.GetAsync(context.GetUser()!.OrganizationId, projectId, contentKind, contentId, pluginId, actionId, cancellationToken);
        return Results.Ok(new { action, data = stored?.Data, revision = stored?.Revision ?? 0, updatedAt = stored?.UpdatedAt,
            mediaKind = target.MediaKind, applicationUrl = action.Renderer == "cyannota" ? options.Value.CyAnnotaUrl.Trim() : null,
            maximumDocumentBytes = action.Renderer == "cyannota" ? CyAnnotaEndpoints.MaximumDocumentBytes : 65_536 });
    }
    private static async Task<IResult> WriteAsync(Guid projectId, string contentKind, Guid contentId, string pluginId, string actionId,
        UpdateContentPluginRequest request, HttpContext context, PluginCatalog catalog, IPluginStore plugins, IContentPluginStore data,
        IWorkspaceStore workspace, ICollaborationStore collaboration, IProjectSpaceStore spaces, WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        if (request.ExpectedRevision < 0 || request.ExpectedRevision == long.MaxValue) return Results.BadRequest();
        var target = await ResolveAsync(projectId, contentKind, contentId, context, workspace, collaboration, cancellationToken);
        if (target is null) return Results.NotFound();
        var action = await ActionAsync(projectId, pluginId, actionId, target.Surface, context, catalog, plugins, cancellationToken);
        if (action is null || action.Renderer == "cymd") return Results.NotFound();
        var user = context.GetUser()!;
        if (target.ChannelId is { } channelId && context.Items[ProjectAccessService.RoleItem]?.ToString() is not ("owner" or "admin")
            && user.Role is not ("owner" or "admin"))
        {
            var space = await spaces.GetAsync(user.OrganizationId, projectId, cancellationToken);
            if (space?.Rooms.Any(x => x.TargetId == channelId && x.Kind == "news") == true) return Results.StatusCode(403);
        }
        if (action.Renderer == "cyannota")
        {
            if (target.MediaKind is null) return Results.BadRequest();
            var validation = CyAnnotaEndpoints.ValidateDocument(request.Data, target.MediaKind, contentId);
            if (validation.Error is not null) return validation.Error;
        }
        else
        {
            var errors = PluginEndpoints.ValidateFields(action.Fields, request.Data);
            if (errors.Count > 0) return Results.ValidationProblem(errors);
        }
        var updated = await data.SaveAsync(new(user.OrganizationId, projectId, contentKind, contentId, pluginId, actionId,
            request.Data, 0, user.UserId, DateTimeOffset.UtcNow), request.ExpectedRevision, cancellationToken);
        if (updated is null) return Results.Problem(statusCode:409, title:"Content changed. Reload before saving.");
        events.Publish(user.OrganizationId, "project.content_plugin_updated", projectId);
        return Results.Ok(new { data = updated.Data, updated.Revision, updated.UpdatedAt });
    }
    private static async Task<PluginContentAction?> ActionAsync(Guid projectId, string pluginId, string actionId, string surface,
        HttpContext context, PluginCatalog catalog, IPluginStore plugins, CancellationToken cancellationToken)
    {
        var action = catalog.Find(pluginId)?.Contributes.ContentActions?.FirstOrDefault(x => x.Id == actionId && x.Surfaces.Contains(surface));
        if (action is null) return null;
        return (await plugins.ListProjectPluginsAsync(context.GetUser()!.OrganizationId, projectId, cancellationToken))
            .Any(x => x.PluginId == pluginId && x.Enabled) ? action : null;
    }
    private sealed record ContentTarget(string Surface, string? MediaKind = null, Guid? ChannelId = null);
    private static async Task<ContentTarget?> ResolveAsync(Guid projectId, string kind, Guid id, HttpContext context,
        IWorkspaceStore workspace, ICollaborationStore collaboration, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        if (kind == "message")
        {
            var channel = await collaboration.FindMessageChannelAsync(user.OrganizationId, id, user.UserId, cancellationToken);
            return channel?.ProjectId == projectId ? new("message", ChannelId:channel.Id) : null;
        }
        if (kind == "task")
        {
            var task = await workspace.GetTaskAsync(user.OrganizationId, id, cancellationToken);
            return task?.Task.ProjectId == projectId ? new("text") : null;
        }
        if (kind != "resource") return null;
        var resource = await collaboration.GetResourceAsync(user.OrganizationId, id, cancellationToken);
        if (resource?.ProjectId != projectId || resource.Status is not ("available" or "ready")) return null;
        var type = resource.DetectedContentType ?? resource.DeclaredContentType ?? "";
        var mediaKind = type.StartsWith("image/", StringComparison.OrdinalIgnoreCase) ? "image"
            : type.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? "video" : null;
        return new(mediaKind is null ? "text" : "media", mediaKind);
    }
}
