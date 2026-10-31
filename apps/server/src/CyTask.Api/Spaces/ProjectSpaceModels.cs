using System.Security.Cryptography;
using System.Text;
using CyTask.Api.Domain;

namespace CyTask.Api.Spaces;

public sealed record ProjectRoom(Guid Id, string Name, string Kind, Guid? CategoryId,
    Guid? TargetId, Guid? FolderLabelId, string Topic, int Position);
public sealed record RoomCategory(Guid Id, string Name, int Position);
public sealed record ProjectSpaceMember(Guid UserId, string Role);
public sealed record ProjectSpaceState(Guid OrganizationId, Guid ProjectId, Guid OwnerId,
    string Visibility, IReadOnlyList<ProjectSpaceMember> Members, IReadOnlyList<ProjectRoom> Rooms,
    IReadOnlyList<RoomCategory> Categories, long Revision, DateTimeOffset UpdatedAt)
{
    public static ProjectSpaceState Default(Project project)
    {
        Guid Id(string key) => new(SHA256.HashData(Encoding.UTF8.GetBytes($"{project.Id:N}:{key}"))[..16]);
        var work = Id("work"); var team = Id("team");
        return new(project.OrganizationId, project.Id, project.CreatedBy, "organization", [],
        [
            new(Id("tasks"), "tasks", "tasks", work, null, null, "Plan, organize and track the project.", 0),
            new(Id("canvas"), "canvas", "canvas", work, null, null, "A shared space for ideas.", 1),
            new(Id("general"), "general", "chat", team, null, null, "The project's conversation.", 2),
            new(Id("files"), "files", "files", team, null, null, "Documents, images, videos and shared files.", 3)
        ], [new(work, "PROJECT", 0), new(team, "TEAM", 1)], 0, project.CreatedAt);
    }
}
public sealed record ProjectSpaceView(ProjectSpaceState Space, string AccessRole);
public sealed record UpdateProjectSpaceRequest(string Visibility, IReadOnlyList<ProjectSpaceMember> Members,
    IReadOnlyList<ProjectRoom> Rooms, IReadOnlyList<RoomCategory> Categories, long ExpectedRevision);
public sealed record CreateProjectRoomRequest(string Name, string Kind, Guid? CategoryId,
    Guid? FolderLabelId, string? Topic, IReadOnlyList<Guid>? MemberIds, long ExpectedRevision);
public sealed record RoomActivity(Guid ChannelId, DateTimeOffset? LatestMessageAt, long MessageCount);

public interface IProjectSpaceStore
{
    Task<ProjectSpaceState?> GetAsync(Guid organizationId, Guid projectId, CancellationToken cancellationToken);
    Task<bool> SaveAsync(ProjectSpaceState value, long expectedRevision, CancellationToken cancellationToken);
}
