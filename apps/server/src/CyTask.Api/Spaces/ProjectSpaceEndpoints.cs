using CyTask.Api.Collaboration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using CyTask.Api.Security;

namespace CyTask.Api.Spaces;

public static class ProjectSpaceEndpoints
{
    private static readonly HashSet<string> RoomKinds = new(StringComparer.Ordinal)
        { "tasks", "chat", "voice", "video", "document", "canvas", "files", "news", "graph" };
    public static void MapProjectSpaceEndpoints(this RouteGroupBuilder routes)
    {
        routes.MapGet("/projects/{projectId:guid}/space", GetAsync);
        routes.MapGet("/projects/{projectId:guid}/rooms/activity", static async (
            Guid projectId, HttpContext context, ICollaborationStore collaboration, CancellationToken cancellationToken) =>
            Results.Ok(await collaboration.ListChannelActivityAsync(context.GetUser()!.OrganizationId,
                projectId, context.GetUser()!.UserId, cancellationToken)));
        routes.MapPut("/projects/{projectId:guid}/space", SaveAsync)
            .AddEndpointFilter<CsrfFilter>().AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        routes.MapPost("/projects/{projectId:guid}/rooms", CreateRoomAsync)
            .AddEndpointFilter<CsrfFilter>().AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
    }
    private static async Task<ProjectSpaceState?> ReadAsync(Guid organizationId, Guid projectId,
        IWorkspaceStore workspace, IProjectSpaceStore spaces, CancellationToken cancellationToken)
    {
        var project = (await workspace.ListProjectsAsync(organizationId, cancellationToken)).FirstOrDefault(x => x.Id == projectId);
        return project is null ? null : await spaces.GetAsync(organizationId, projectId, cancellationToken)
            ?? ProjectSpaceState.Default(project);
    }
    private static async Task<IResult> GetAsync(Guid projectId, HttpContext context, IWorkspaceStore workspace,
        IProjectSpaceStore spaces, ProjectAccessService access, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var space = await ReadAsync(user.OrganizationId, projectId, workspace, spaces, cancellationToken);
        return space is null ? Results.NotFound() : Results.Ok(new ProjectSpaceView(space,
            await access.RoleAsync(user, projectId, cancellationToken) ?? "viewer"));
    }
    private static async Task<IResult> SaveAsync(Guid projectId, UpdateProjectSpaceRequest request,
        HttpContext context, IWorkspaceStore workspace, IProjectSpaceStore spaces,
        ICollaborationStore collaboration, WorkspaceEventHub events, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var current = await ReadAsync(user.OrganizationId, projectId, workspace, spaces, cancellationToken);
        if (current is null) return Results.NotFound();
        if (request.ExpectedRevision != current.Revision) return Results.Conflict(new { title = "Project settings changed. Reload before saving." });
        if (request.Visibility is not ("organization" or "private") || request.Members is null
            || request.Rooms is null || request.Categories is null || request.Members.Count > 1000
            || request.Rooms.Count > 200 || request.Categories.Count > 100
            || request.Members.Any(x => x is null) || request.Rooms.Any(x => x is null) || request.Categories.Any(x => x is null)
            || request.Members.Select(x => x.UserId).Distinct().Count() != request.Members.Count
            || request.Members.Any(x => x.Role is not ("admin" or "member" or "viewer"))
            || request.Rooms.Select(x => x.Id).Distinct().Count() != request.Rooms.Count
            || request.Categories.Select(x => x.Id).Distinct().Count() != request.Categories.Count
            || request.Categories.Any(x => x.Id == Guid.Empty || !ValidName(x.Name)))
            return Invalid("Invalid project settings.");
        var members = await workspace.ListMembersAsync(user.OrganizationId, cancellationToken);
        if (request.Members.Any(x => !members.Any(m => m.UserId == x.UserId))) return Invalid("Member belongs to another organization.");
        var labels = await workspace.GetProjectLabelsAsync(user.OrganizationId, projectId, cancellationToken);
        foreach (var room in request.Rooms)
        {
            if (room.Id == Guid.Empty || !ValidName(room.Name) || !RoomKinds.Contains(room.Kind)
                || room.Topic is null || room.Topic.Length > 2000
                || room.CategoryId is { } category && !request.Categories.Any(x => x.Id == category))
                return Invalid("Invalid room.");
            if (room.FolderLabelId is { } folder && labels?.Labels.Any(x => x.Id == folder) != true)
                return Invalid("Invalid task folder.");
            if (room.TargetId is { } target)
            {
                if (room.Kind is "chat" or "voice" or "video" or "news")
                {
                    var channel = await collaboration.GetChannelAsync(user.OrganizationId, target, user.UserId, cancellationToken);
                    if (channel?.ProjectId != projectId || channel.ChannelType != "channel") return Invalid("Room channel must be a public channel of this project.");
                }
                else
                {
                    var resource = await collaboration.GetResourceAsync(user.OrganizationId, target, cancellationToken);
                    if (resource?.ProjectId != projectId || resource.ResourceType != room.Kind) return Invalid("Room content is invalid.");
                }
            }
        }
        var next = current with { Visibility = request.Visibility, Members = request.Members.ToArray(),
            Rooms = request.Rooms.ToArray(), Categories = request.Categories.ToArray(),
            Revision = current.Revision + 1, UpdatedAt = DateTimeOffset.UtcNow };
        if (!await spaces.SaveAsync(next, current.Revision, cancellationToken)) return Results.Conflict();
        events.Publish(user.OrganizationId, "project.space_updated", projectId);
        return Results.Ok(next);
    }
    private static async Task<IResult> CreateRoomAsync(Guid projectId, CreateProjectRoomRequest request,
        HttpContext context, IWorkspaceStore workspace, IProjectSpaceStore spaces,
        ICollaborationStore collaboration, WorkspaceEventHub events, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var current = await ReadAsync(user.OrganizationId, projectId, workspace, spaces, cancellationToken);
        if (current is null) return Results.NotFound();
        if (current.Revision != request.ExpectedRevision) return Results.Conflict();
        if (!ValidName(request.Name) || !RoomKinds.Contains(request.Kind) || current.Rooms.Count >= 200
            || request.MemberIds is { Count: > 0 }
            || (request.Topic?.Length ?? 0) > 2000
            || request.CategoryId is { } category && !current.Categories.Any(x => x.Id == category)) return Invalid("Invalid room.");
        if (request.FolderLabelId is { } folder)
        {
            var labels = await workspace.GetProjectLabelsAsync(user.OrganizationId, projectId, cancellationToken);
            if (labels?.Labels.Any(x => x.Id == folder) != true) return Invalid("Invalid task folder.");
        }
        Guid? targetId = null;
        var id = Guid.CreateVersion7();
        if (request.Kind is "chat" or "voice" or "video" or "news")
        {
            var ids = request.MemberIds?.Distinct().ToArray() ?? [];
            if (ids.Length > 49) return Invalid("A private room accepts at most 50 members.");
            var channel = await collaboration.CreateChannelAsync(user.OrganizationId, projectId,
                request.Name.Trim(), $"room-{id:N}", (request.Topic ?? "")[..Math.Min(request.Topic?.Length ?? 0, 500)],
                ids.Length > 0 ? "group" : "channel", ids, user.UserId, cancellationToken);
            if (channel is null) return Invalid("Unable to create the room channel.");
            targetId = channel.Id;
        }
        else if (request.Kind is "document" or "canvas")
        {
            var resource = await collaboration.CreateResourceAsync(user.OrganizationId, projectId,
                request.FolderLabelId, request.Kind, request.Name.Trim(), request.Kind == "canvas"
                    ? "{\"version\":1,\"objects\":[],\"strokes\":[]}" : "", user.UserId, cancellationToken);
            if (resource is null) return Invalid("Unable to create the room page.");
            targetId = resource.Id;
        }
        var room = new ProjectRoom(id, request.Name.Trim(), request.Kind, request.CategoryId,
            targetId, request.FolderLabelId, request.Topic ?? "", current.Rooms.Count);
        var next = current with { Rooms = [.. current.Rooms, room], Revision = current.Revision + 1, UpdatedAt = DateTimeOffset.UtcNow };
        if (!await spaces.SaveAsync(next, current.Revision, cancellationToken)) return Results.Conflict();
        events.Publish(user.OrganizationId, "project.space_updated", projectId);
        return Results.Created($"/api/v1/projects/{projectId}/rooms/{id}", next);
    }
    private static bool ValidName(string? name) => name is not null && name.Trim().Length is >= 1 and <= 80 && !name.Any(char.IsControl);
    private static IResult Invalid(string message) => Results.ValidationProblem(new Dictionary<string, string[]> { ["room"] = [message] });
}
