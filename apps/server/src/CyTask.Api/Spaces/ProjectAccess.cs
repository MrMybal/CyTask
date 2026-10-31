using CyTask.Api.Collaboration;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Security;

namespace CyTask.Api.Spaces;

public sealed class ProjectAccessService(IProjectSpaceStore spaces, IWorkspaceStore workspace, ICollaborationStore collaboration)
{
    public const string RoleItem = "CyTask.ProjectRole";
    public async Task<string?> RoleAsync(AuthenticatedUser user, Guid projectId, CancellationToken cancellationToken)
    {
        if (user.Role is "owner" or "admin") return user.Role;
        var space = await spaces.GetAsync(user.OrganizationId, projectId, cancellationToken);
        if (space is null) return user.Role;
        if (space.OwnerId == user.UserId) return "owner";
        var member = space.Members.FirstOrDefault(x => x.UserId == user.UserId);
        return member?.Role ?? (space.Visibility == "organization" ? user.Role : null);
    }
    public async Task<Guid?> ResolveAsync(AuthenticatedUser user, string kind, Guid id, CancellationToken cancellationToken)
    {
        switch (kind)
        {
            case "project": return id;
            case "task": return (await workspace.GetTaskAsync(user.OrganizationId, id, cancellationToken))?.Task.ProjectId;
            case "resource": return (await collaboration.GetResourceAsync(user.OrganizationId, id, cancellationToken))?.ProjectId;
            case "channel": return (await collaboration.GetChannelAsync(user.OrganizationId, id, user.UserId, cancellationToken))?.ProjectId;
            case "resource-upload": return (await collaboration.GetResourceUploadAsync(user.OrganizationId, id, cancellationToken))?.Resource.ProjectId;
            case "attachment":
                var attachment = await workspace.FindAttachmentAsync(user.OrganizationId, id, cancellationToken);
                return attachment is null ? null : (await workspace.GetTaskAsync(user.OrganizationId, attachment.TaskId, cancellationToken))?.Task.ProjectId;
            case "attachment-upload":
                var upload = await workspace.GetAttachmentUploadAsync(user.OrganizationId, id, cancellationToken);
                return upload is null ? null : (await workspace.GetTaskAsync(user.OrganizationId, upload.Attachment.TaskId, cancellationToken))?.Task.ProjectId;
            default: return null;
        }
    }
    public async Task<bool> CanReadEntityAsync(AuthenticatedUser user, string kind, Guid id, CancellationToken cancellationToken)
    {
        if (user.Role is "owner" or "admin") return true;
        var projectId = await ResolveAsync(user, kind, id, cancellationToken);
        return projectId is not null && await RoleAsync(user, projectId.Value, cancellationToken) is not null;
    }
}

public sealed class ProjectAccessFilter(ProjectAccessService access, IProjectSpaceStore spaces) : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var user = http.GetUser()!;
        if (user.Role is "owner" or "admin") return await next(context);
        var write = !HttpMethods.IsGet(http.Request.Method) && !HttpMethods.IsHead(http.Request.Method)
            && !HttpMethods.IsOptions(http.Request.Method);
        string? effectiveRole = null;
        foreach (var (key, kind) in new[] { ("projectId", "project"), ("taskId", "task"),
            ("parentTaskId", "task"), ("dependsOnTaskId", "task"), ("attachmentId", "attachment"),
            ("resourceId", "resource"), ("channelId", "channel"),
            ("uploadId", http.Request.Path.StartsWithSegments("/api/v1/resource-uploads") ? "resource-upload" : "attachment-upload") })
        {
            if (!http.Request.RouteValues.TryGetValue(key, out var raw) || !Guid.TryParse(raw?.ToString(), out var id)) continue;
            var projectId = await access.ResolveAsync(user, kind, id, http.RequestAborted);
            if (projectId is null) return Results.NotFound();
            var role = await access.RoleAsync(user, projectId.Value, http.RequestAborted);
            if (role is null) return Results.NotFound();
            if (write && role == "viewer") return Results.Problem(statusCode: 403, title: "This project is read-only");
            effectiveRole ??= role;
            if (key == "channelId" && write && role is not ("owner" or "admin"))
            {
                var space = await spaces.GetAsync(user.OrganizationId, projectId.Value, http.RequestAborted);
                if (space?.Rooms.Any(x => x.TargetId == id && x.Kind == "news") == true)
                    return Results.Problem(statusCode: 403, title: "Only project administrators can publish announcements");
            }
        }
        if (effectiveRole is not null) http.Items[ProjectAccessService.RoleItem] = effectiveRole;
        return await next(context);
    }
}
