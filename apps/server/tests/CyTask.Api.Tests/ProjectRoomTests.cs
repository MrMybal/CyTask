using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using CyTask.Api.Spaces;
using CyTask.Api.LocalSync;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace CyTask.Api.Tests;
public sealed partial class CyTaskApiTests
{
    [Fact]
    public async Task ProjectPrivacyProtectsListsTasksResourcesAndChat()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(owner));
        var project = await PostAndReadAsync(owner, "/api/v1/projects", new { name = "Private sentinel", key = "PV" });
        var projectId = project.GetProperty("id").GetGuid();
        var task = await PostAndReadAsync(owner, $"/api/v1/projects/{projectId}/tasks", new { title = "Private sentinel", description = "Private project fixture" });
        var resource = await PostAndReadAsync(owner, $"/api/v1/projects/{projectId}/resources", new { resourceType = "document", name = "Private sentinel", body = "Fixture" });
        var channel = await PostAndReadAsync(owner, $"/api/v1/projects/{projectId}/chat/channels", new { name = "Private sentinel", topic = "" });
        using var member = factory.CreateClient();
        var invitation = await PostAndReadAsync(owner, "/api/v1/invitations", new { email = "rooms-member@fixture.invalid", role = "member" });
        using var accepted = await member.PostAsJsonAsync(new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new { token = invitation.GetProperty("token").GetString(), displayName = "Room member", password = "Fictional room fixture password 9427" }, TestContext.Current.CancellationToken);
        accepted.EnsureSuccessStatusCode();
        var identity = await ReadJsonAsync(accepted);
        var memberId = identity.GetProperty("userId").GetGuid();
        member.DefaultRequestHeaders.Add("X-CSRF-Token", identity.GetProperty("csrfToken").GetString());
        var space = await ReadSpaceAsync(owner, projectId);
        space = await SaveSpaceAsync(owner, space with { Visibility = "private" });
        foreach (var path in new[] { $"/projects/{projectId}/space", $"/tasks/{task.GetProperty("id").GetGuid()}",
            $"/resources/{resource.GetProperty("id").GetGuid()}", $"/chat/channels/{channel.GetProperty("id").GetGuid()}/messages" })
        {
            using var rejected = await member.GetAsync(new Uri("/api/v1" + path, UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.NotFound, rejected.StatusCode);
        }
        using var projects = await member.GetAsync(new Uri("/api/v1/projects", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Empty((await ReadJsonAsync(projects)).EnumerateArray());
        using var search = await member.GetAsync(new Uri("/api/v1/search?q=sentinel", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Empty((await ReadJsonAsync(search)).EnumerateArray());
        space = await SaveSpaceAsync(owner, space with { Members = [new(memberId, "viewer")] });
        using var allowed = await member.GetAsync(new Uri($"/api/v1/tasks/{task.GetProperty("id").GetGuid()}", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        using var deniedWrite = await member.PostAsJsonAsync(new Uri($"/api/v1/projects/{projectId}/tasks", UriKind.Relative),
            new { title = "Cannot write", description = "" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, deniedWrite.StatusCode);
        space = await SaveSpaceAsync(owner, space with { Members = [new(memberId, "admin")] });
        var createdRoom = await PostAndReadAsync(member, $"/api/v1/projects/{projectId}/rooms", new
        {
            name = "announcements", kind = "news", categoryId = (Guid?)null, topic = "**Project updates**", expectedRevision = space.Revision
        });
        Assert.Equal("news", createdRoom.GetProperty("rooms").EnumerateArray().Last().GetProperty("kind").GetString());
        space = await ReadSpaceAsync(owner, projectId);
        var newsId = space.Rooms[^1].TargetId;
        space = await SaveSpaceAsync(owner, space with { Members = [new(memberId, "member")] });
        using var deniedAnnouncement = await member.PostAsJsonAsync(new Uri($"/api/v1/chat/channels/{newsId}/messages", UriKind.Relative),
            new { body = "Cannot publish" }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, deniedAnnouncement.StatusCode);
    }

    [Fact]
    public async Task RoomPagesAreBackedByResourcesAndSettingsUseOptimisticRevisions()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(client));
        var project = await PostAndReadAsync(client, "/api/v1/projects", new { name = "Room pages", key = "RP" });
        var id = project.GetProperty("id").GetGuid();
        var initial = await ReadSpaceAsync(client, id);
        Assert.Equal(4, initial.Rooms.Count);
        var created = await PostAndReadAsync(client, $"/api/v1/projects/{id}/rooms", new
        { name = "Design document", kind = "document", categoryId = initial.Categories[0].Id, topic = "A document", expectedRevision = initial.Revision });
        var room = created.GetProperty("rooms").EnumerateArray().Last();
        using var resource = await client.GetAsync(new Uri($"/api/v1/resources/{room.GetProperty("targetId").GetGuid()}", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal("document", (await ReadJsonAsync(resource)).GetProperty("resourceType").GetString());
        using var conflict = await client.PutAsJsonAsync(new Uri($"/api/v1/projects/{id}/space", UriKind.Relative),
            new UpdateProjectSpaceRequest(initial.Visibility, initial.Members, initial.Rooms, initial.Categories, initial.Revision), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, conflict.StatusCode);
        Assert.Equal(5, (await ReadSpaceAsync(client, id)).Rooms.Count);
    }

    [Fact]
    public async Task RoomLayoutAndPermissionsSurviveLocalRestart()
    {
        var root = Path.Combine(Path.GetTempPath(), "CyTask.RoomTests", Guid.NewGuid().ToString("N"));
        var device = Guid.NewGuid();
        Guid id;
        try
        {
            await using (var factory = new CyTaskApiFactory(root, device))
            using (var client = factory.CreateClient())
            {
                client.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(client));
                var project = await PostAndReadAsync(client, "/api/v1/projects", new { name = "Local rooms", key = "LR" });
                id = project.GetProperty("id").GetGuid();
                await PostAndReadAsync(client, $"/api/v1/projects/{id}/rooms", new { name = "planning", kind = "tasks", topic = "Fixture", expectedRevision = 0 });
                var space = await ReadSpaceAsync(client, id);
                await SaveSpaceAsync(client, space with { Visibility = "private" });
                await factory.Services.GetRequiredService<ILocalSyncService>().FlushAsync(TestContext.Current.CancellationToken);
            }
            await using var restarted = new CyTaskApiFactory(root, device);
            using var reopened = restarted.CreateClient();
            await LoginAsync(reopened);
            var restored = await ReadSpaceAsync(reopened, id);
            Assert.Equal("private", restored.Visibility);
            Assert.Contains(restored.Rooms, room => room.Name == "planning");
            Assert.Equal(2, restored.Revision);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    private static async Task<ProjectSpaceState> ReadSpaceAsync(HttpClient client, Guid projectId)
    {
        using var response = await client.GetAsync(new Uri($"/api/v1/projects/{projectId}/space", UriKind.Relative), TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectSpaceView>(TestContext.Current.CancellationToken))!.Space;
    }

    [Fact]
    public async Task MalformedRoomSettingsReturnBadRequest()
    {
        await using var factory=new CyTaskApiFactory();using var client=factory.CreateClient();
        client.DefaultRequestHeaders.Add("X-CSRF-Token",await BootstrapAsync(client));
        var project=await PostAndReadAsync(client,"/api/v1/projects",new{name="Validation fixture",key="VF"});var id=project.GetProperty("id").GetGuid();
        using var badId=await client.PostAsJsonAsync(new Uri($"/api/v1/projects/{id}/rooms",UriKind.Relative),
            new{name="chat",kind="chat",folderLabelId="null",expectedRevision=0},TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest,badId.StatusCode);
        using var nullRoom=await client.PutAsJsonAsync(new Uri($"/api/v1/projects/{id}/space",UriKind.Relative),
            new{visibility="organization",members=Array.Empty<object>(),categories=Array.Empty<object>(),rooms=new object?[]{null},expectedRevision=0},TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest,nullRoom.StatusCode);
    }
    private static async Task<ProjectSpaceState> SaveSpaceAsync(HttpClient client, ProjectSpaceState space)
    {
        using var response = await client.PutAsJsonAsync(new Uri($"/api/v1/projects/{space.ProjectId}/space", UriKind.Relative),
            new UpdateProjectSpaceRequest(space.Visibility, space.Members, space.Rooms, space.Categories, space.Revision), TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<ProjectSpaceState>(TestContext.Current.CancellationToken))!;
    }
}
