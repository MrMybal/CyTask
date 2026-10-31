using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace CyTask.Api.Tests;

public sealed partial class CyTaskApiTests
{
    [Fact]
    public async Task EncryptedLocalWorkspaceRestoresOnAnotherDeviceAndRefusesMissingKeys()
    {
        var folder = Path.Combine(Path.GetTempPath(), "CyTask-EncryptedLocal-Fixture-" + Guid.NewGuid().ToString("N"));
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)); Guid projectId;
        try
        {
            await using (var first = new CyTaskApiFactory(folder, Guid.NewGuid(), dataEncryptionKey: key))
            using (var client = first.CreateClient())
            {
                var csrf = await BootstrapAsync(client); client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
                var project = await PostAndReadAsync(client, "/api/v1/projects", new { name = "Encrypted fixture project", key = "ENC" });
                projectId = project.GetProperty("id").GetGuid();
                await PostAndReadAsync(client, $"/api/v1/projects/{projectId}/tasks", new { title = "Private fixture task", description = "Encrypted snapshot contents" });
                using var flush = await client.PostAsync(new Uri("/api/v1/local-sync/flush", UriKind.Relative), null, TestContext.Current.CancellationToken);
                flush.EnsureSuccessStatusCode();
            }
            foreach (var path in Directory.EnumerateFiles(folder, "*.json", SearchOption.AllDirectories))
            {
                var bytes = await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken);
                Assert.DoesNotContain("Private fixture task", Encoding.UTF8.GetString(bytes));
                Assert.DoesNotContain("Encrypted fixture project", Encoding.UTF8.GetString(bytes));
            }
            await using (var second = new CyTaskApiFactory(folder, Guid.NewGuid(), dataEncryptionKey: key))
            using (var client = second.CreateClient())
            {
                using var login = await client.PostAsJsonAsync(new Uri("/api/v1/sessions", UriKind.Relative), new { email = "owner@cytask.local", password = "correct horse battery staple" }, TestContext.Current.CancellationToken);
                login.EnsureSuccessStatusCode();
                using var tasks = await client.GetAsync(new Uri($"/api/v1/projects/{projectId}/tasks", UriKind.Relative), TestContext.Current.CancellationToken);
                tasks.EnsureSuccessStatusCode();
                Assert.Contains((await ReadJsonAsync(tasks)).EnumerateArray(), task => task.GetProperty("title").GetString() == "Private fixture task");
                using var status = await client.GetAsync(new Uri("/api/v1/storage/security", UriKind.Relative), TestContext.Current.CancellationToken);
                status.EnsureSuccessStatusCode(); Assert.True((await ReadJsonAsync(status)).GetProperty("encryptionAtRest").GetBoolean());
            }
            var count = Directory.GetFiles(folder, "*.json", SearchOption.AllDirectories).Length;
            await using (var missing = new CyTaskApiFactory(folder, Guid.NewGuid()))
                Assert.ThrowsAny<Exception>(() => missing.CreateClient());
            await using (var wrong = new CyTaskApiFactory(folder, Guid.NewGuid(), dataEncryptionKey: Convert.ToBase64String(RandomNumberGenerator.GetBytes(32))))
                Assert.ThrowsAny<Exception>(() => wrong.CreateClient());
            Assert.Equal(count, Directory.GetFiles(folder, "*.json", SearchOption.AllDirectories).Length);
        }
        finally { if (Directory.Exists(folder)) Directory.Delete(folder, true); }
    }
}
