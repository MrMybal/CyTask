using System.Net;
using System.Net.Http.Json;
using CyTask.Api.Infrastructure;
using CyTask.Api.LocalSync;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace CyTask.Api.Tests;

public sealed partial class CyTaskApiTests
{
    [Fact]
    public async Task ProductionLocalSessionUsesCookiesAcceptedOnLoopbackHttp()
    {
        var root = Path.Combine(Path.GetTempPath(), "CyTask.CookieRegression", Guid.NewGuid().ToString("N"));
        try
        {
            await using var factory = new CyTaskApiFactory(root, Guid.NewGuid(), production: true);
            using var client = factory.CreateClient();
            using var request = new HttpRequestMessage(HttpMethod.Post, "/api/v1/local/session");
            request.Headers.Add("X-CyTask-Local-Key", LocalAccessKey);
            using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var cookies = response.Headers.GetValues("Set-Cookie").ToArray();
            Assert.Contains(cookies, cookie => cookie.StartsWith("CyTask.Session=", StringComparison.Ordinal));
            Assert.DoesNotContain(cookies, cookie => cookie.StartsWith("__Host-", StringComparison.Ordinal));
            using var me = await client.GetAsync(new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, me.StatusCode);
            client.DefaultRequestHeaders.Add("X-CSRF-Token", (await ReadJsonAsync(response)).GetProperty("csrfToken").GetString());
            using var logout = await client.DeleteAsync(new Uri("/api/v1/session", UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
            using var afterLogout = await client.GetAsync(new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task OldPeerSnapshotCannotUndoAProjectStatusUpdate()
    {
        var root = Path.Combine(Path.GetTempPath(), "CyTask.StatusRegression", Guid.NewGuid().ToString("N"));
        try
        {
            await using var first = new CyTaskApiFactory(root, Guid.Parse("10000000-0000-4000-8000-000000000001"));
            using var client = first.CreateClient();
            client.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(client));
            var project = await PostAndReadAsync(client, "/api/v1/projects", new { name = "Statuses", key = "ST" });
            var projectId = project.GetProperty("id").GetGuid();
            using var initial = await client.PatchAsJsonAsync(
                new Uri($"/api/v1/projects/{projectId}/statuses/todo", UriKind.Relative),
                new { name = "Initial", color = "#112233" }, TestContext.Current.CancellationToken);
            initial.EnsureSuccessStatusCode();
            var sync = first.Services.GetRequiredService<ILocalSyncService>();
            await sync.FlushAsync(TestContext.Current.CancellationToken);
            await using var peer = new CyTaskApiFactory(root, Guid.Parse("f0000000-0000-4000-8000-000000000002"));
            using var peerClient = peer.CreateClient();
            await LoginAsync(peerClient);
            using var update = await client.PatchAsJsonAsync(
                new Uri($"/api/v1/projects/{projectId}/statuses/todo", UriKind.Relative),
                new { name = "Updated", color = "#ABCDEF" }, TestContext.Current.CancellationToken);
            update.EnsureSuccessStatusCode();
            await sync.FlushAsync(TestContext.Current.CancellationToken);
            using var statuses = await client.GetAsync(
                new Uri($"/api/v1/projects/{projectId}/statuses", UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Contains((await ReadJsonAsync(statuses)).EnumerateArray(),
                status => status.GetProperty("key").GetString() == "todo"
                    && status.GetProperty("name").GetString() == "Updated");
            var snapshots = Directory.GetFiles(root, "*.json", SearchOption.AllDirectories);
            await sync.FlushAsync(TestContext.Current.CancellationToken);
            Assert.Equal(snapshots.Length, Directory.GetFiles(root, "*.json", SearchOption.AllDirectories).Length);
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task LocalAnnotationsSurviveRestart()
    {
        var root = Path.Combine(Path.GetTempPath(), "CyTask.AnnotationRegression", Guid.NewGuid().ToString("N"));
        var device = Guid.NewGuid();
        try
        {
            Guid taskId;
            Guid attachmentId;
            await using (var factory = new CyTaskApiFactory(root, device))
            using (var client = factory.CreateClient())
            {
                client.DefaultRequestHeaders.Add("X-CSRF-Token", await BootstrapAsync(client));
                var project = await PostAndReadAsync(client, "/api/v1/projects", new { name = "Annotations", key = "AN" });
                var projectId = project.GetProperty("id").GetGuid();
                var task = await PostAndReadAsync(client, $"/api/v1/projects/{projectId}/tasks", new { title = "Media", description = "" });
                taskId = task.GetProperty("id").GetGuid();
                using var enabled = await client.PutAsync(
                    new Uri($"/api/v1/projects/{projectId}/plugins/dev.cytask.cyannota", UriKind.Relative), null,
                    TestContext.Current.CancellationToken);
                enabled.EnsureSuccessStatusCode();
                var attachment = await UploadAttachmentAsync(client, taskId, "fixture.png", "image/png", SinglePixelPng());
                attachmentId = attachment.GetProperty("id").GetGuid();
                await factory.ReviewAttachmentsAsync();
                using var saved = await client.PutAsJsonAsync(
                    new Uri($"/api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}", UriKind.Relative),
                    new { document = new { version = 1, annotations = Array.Empty<object>(), title = "Preserved" }, expectedRevision = 0 },
                    TestContext.Current.CancellationToken);
                saved.EnsureSuccessStatusCode();
                await factory.Services.GetRequiredService<ILocalSyncService>().FlushAsync(TestContext.Current.CancellationToken);
            }
            await using var reopened = new CyTaskApiFactory(root, device);
            using var reader = reopened.CreateClient();
            await LoginAsync(reader);
            using var response = await reader.GetAsync(
                new Uri($"/api/v1/tasks/{taskId}/plugins/cyannota/media/{attachmentId}", UriKind.Relative),
                TestContext.Current.CancellationToken);
            var document = await ReadJsonAsync(response);
            Assert.Equal(1, document.GetProperty("revision").GetInt64());
            Assert.Equal("Preserved", document.GetProperty("document").GetProperty("title").GetString());
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }

    [Fact]
    public async Task SnapshotLargerThan64MiBRestoresAllTasks()
    {
        var root = Path.Combine(Path.GetTempPath(), "CyTask.VolumeRegression", Guid.NewGuid().ToString("N"));
        var device = Guid.NewGuid();
        try
        {
            Guid projectId;
            const int count = 3400;
            await using (var factory = new CyTaskApiFactory(root, device))
            using (var client = factory.CreateClient())
            {
                await BootstrapAsync(client);
                var store = factory.Services.GetRequiredService<IWorkspaceStore>();
                var owner = (await store.FindLocalOwnerAsync(TestContext.Current.CancellationToken))!;
                using var me = await client.GetAsync(new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
                var organizationId = (await ReadJsonAsync(me)).GetProperty("organizationId").GetGuid();
                var project = (await store.CreateProjectAsync(organizationId, owner.Id, "Volume", "VOL", TestContext.Current.CancellationToken))!;
                projectId = project.Id;
                var body = new string('x', 20_000);
                for (var index = 0; index < count; index++)
                    await store.CreateTaskAsync(organizationId, project.Id, owner.Id,
                        $"Task {index}", body, "normal", null, [], TestContext.Current.CancellationToken);
                await factory.Services.GetRequiredService<ILocalSyncService>().FlushAsync(TestContext.Current.CancellationToken);
                Assert.Contains(Directory.GetFiles(root, "*.json", SearchOption.AllDirectories),
                    file => new FileInfo(file).Length > 64 * 1024 * 1024);
            }
            await using var reopened = new CyTaskApiFactory(root, device);
            using var reader = reopened.CreateClient();
            await LoginAsync(reader);
            using var response = await reader.GetAsync(
                new Uri($"/api/v1/projects/{projectId}/task-options", UriKind.Relative), TestContext.Current.CancellationToken);
            Assert.Equal(count, (await ReadJsonAsync(response)).GetArrayLength());
        }
        finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
}
