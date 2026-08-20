using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.Extensions.DependencyInjection;
using CyTask.Api.Media;
using Xunit;

namespace CyTask.Api.Tests;

public sealed class CyTaskApiTests
{
    [Fact]
    public async Task HealthEndpointsReportLiveAndReady()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();

        using var live = await client.GetAsync(
            new Uri("/health/live", UriKind.Relative), TestContext.Current.CancellationToken);
        using var ready = await client.GetAsync(
            new Uri("/health/ready", UriKind.Relative), TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
        Assert.Equal(HttpStatusCode.OK, ready.StatusCode);
    }

    [Fact]
    public async Task ProtectedRoutesRejectAnonymousRequests()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            new Uri("/api/v1/projects", UriKind.Relative), TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task BootstrapCanOnlyRunOnce()
    {
        await using var factory = new CyTaskApiFactory();
        using var firstClient = factory.CreateClient();
        using var secondClient = factory.CreateClient();
        var request = CreateBootstrapRequest();

        using var first = await firstClient.PostAsJsonAsync(
            new Uri("/api/v1/bootstrap", UriKind.Relative), request, TestContext.Current.CancellationToken);
        using var second = await secondClient.PostAsJsonAsync(
            new Uri("/api/v1/bootstrap", UriKind.Relative), request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, first.StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
    }

    [Fact]
    public async Task MutationsRequireTheSessionCsrfToken()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        await BootstrapAsync(client);

        using var response = await client.PostAsJsonAsync(
            new Uri("/api/v1/projects", UriKind.Relative),
            new { name = "CyTask", key = "CY" },
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task SessionCanBeRevokedAndCreatedAgain()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);

        using var logout = await client.DeleteAsync(
            new Uri("/api/v1/session", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);

        using var afterLogout = await client.GetAsync(
            new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterLogout.StatusCode);

        client.DefaultRequestHeaders.Remove("X-CSRF-Token");
        using var login = await client.PostAsJsonAsync(
            new Uri("/api/v1/sessions", UriKind.Relative),
            new { email = "owner@cytask.local", password = "correct horse battery staple" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, login.StatusCode);
    }

    [Fact]
    public async Task NativeAuthorizationUsesPkceOneTimeCodesAndRevocableBearerTokens()
    {
        await using var factory = new CyTaskApiFactory();
        using var browser = factory.CreateClient();
        var csrf = await BootstrapAsync(browser);
        browser.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);

        const string redirectUri = "http://127.0.0.1:49152/cytask/oauth/callback";
        var verifier = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        var challenge = WebEncoders.Base64UrlEncode(
            SHA256.HashData(Encoding.ASCII.GetBytes(verifier)));
        var state = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(24));

        using var rejectedRedirect = await browser.PostAsJsonAsync(
            new Uri("/api/v1/oauth/native/authorizations", UriKind.Relative),
            new
            {
                clientId = "cytask-unreal",
                redirectUri = "http://localhost:49152/cytask/oauth/callback",
                codeChallenge = challenge,
                codeChallengeMethod = "S256",
                state
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, rejectedRedirect.StatusCode);

        using var authorizationResponse = await browser.PostAsJsonAsync(
            new Uri("/api/v1/oauth/native/authorizations", UriKind.Relative),
            new
            {
                clientId = "cytask-unreal",
                redirectUri,
                codeChallenge = challenge,
                codeChallengeMethod = "S256",
                state
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, authorizationResponse.StatusCode);
        Assert.Contains("no-store", authorizationResponse.Headers.CacheControl?.ToString());

        var authorization = await ReadJsonAsync(authorizationResponse);
        var callback = new Uri(authorization.GetProperty("redirectUri").GetString()!);
        var callbackQuery = QueryHelpers.ParseQuery(callback.Query);
        var code = callbackQuery["code"].ToString();
        Assert.Equal(state, callbackQuery["state"].ToString());
        Assert.Equal("127.0.0.1", callback.Host);
        Assert.Equal(49152, callback.Port);

        using var wrongVerifier = await PostTokenAsync(
            browser, code, redirectUri, new string('x', 43));
        Assert.Equal(HttpStatusCode.BadRequest, wrongVerifier.StatusCode);

        using var tokenResponse = await PostTokenAsync(browser, code, redirectUri, verifier);
        Assert.Equal(HttpStatusCode.OK, tokenResponse.StatusCode);
        Assert.Contains("no-store", tokenResponse.Headers.CacheControl?.ToString());
        var token = await ReadJsonAsync(tokenResponse);
        var accessToken = token.GetProperty("access_token").GetString()!;
        Assert.StartsWith("cyt_at_", accessToken, StringComparison.Ordinal);
        Assert.Equal("Bearer", token.GetProperty("token_type").GetString());

        using var replay = await PostTokenAsync(browser, code, redirectUri, verifier);
        Assert.Equal(HttpStatusCode.BadRequest, replay.StatusCode);

        using var nativeClient = factory.CreateClient(new WebApplicationFactoryClientOptions
        {
            HandleCookies = false
        });
        nativeClient.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        using var me = await nativeClient.GetAsync(
            new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, me.StatusCode);

        using var project = await nativeClient.PostAsJsonAsync(
            new Uri("/api/v1/projects", UriKind.Relative),
            new { name = "Projet Unreal", key = "UE" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, project.StatusCode);

        using var bearerCannotMint = await nativeClient.PostAsJsonAsync(
            new Uri("/api/v1/oauth/native/authorizations", UriKind.Relative),
            new
            {
                clientId = "cytask-unreal",
                redirectUri,
                codeChallenge = challenge,
                codeChallengeMethod = "S256",
                state
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, bearerCannotMint.StatusCode);

        using var revoked = await nativeClient.DeleteAsync(
            new Uri("/api/v1/oauth/token", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, revoked.StatusCode);
        using var afterRevocation = await nativeClient.GetAsync(
            new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevocation.StatusCode);

        browser.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "cyt_at_invalid");
        using var noCookieFallback = await browser.GetAsync(
            new Uri("/api/v1/me", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, noCookieFallback.StatusCode);
    }

    [Fact]
    public async Task TeamCanCreateProjectTaskAndComment()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        using var membersResponse = await client.GetAsync(
            new Uri("/api/v1/members", UriKind.Relative), TestContext.Current.CancellationToken);
        var members = await ReadJsonAsync(membersResponse);
        var ownerId = Assert.Single(members.EnumerateArray()).GetProperty("userId").GetGuid();

        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "CyTask", key = "CY" });
        var projectId = project.GetProperty("id").GetGuid();

        var task = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new
            {
                title = "Premier incrément",
                description = "Relier le Web et le serveur.",
                priority = "high",
                dueAt = "2026-09-15T16:00:00Z",
                assigneeId = ownerId
            });
        var taskId = task.GetProperty("id").GetGuid();
        Assert.Equal("CY-1", task.GetProperty("key").GetString());
        Assert.Equal("high", task.GetProperty("priority").GetString());
        Assert.Equal(
            DateTimeOffset.Parse("2026-09-15T16:00:00Z", CultureInfo.InvariantCulture),
            task.GetProperty("dueAt").GetDateTimeOffset());
        Assert.Equal(ownerId, task.GetProperty("assigneeId").GetGuid());
        Assert.Equal("CyTask Owner", task.GetProperty("assigneeName").GetString());

        var comment = await PostAndReadAsync(
            client,
            $"/api/v1/tasks/{taskId}/comments",
            new { body = "La boucle verticale fonctionne." });
        Assert.Equal("La boucle verticale fonctionne.", comment.GetProperty("body").GetString());

        using var detailsResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, detailsResponse.StatusCode);
        var details = await ReadJsonAsync(detailsResponse);
        Assert.Equal(2, details.GetProperty("task").GetProperty("revision").GetInt64());
        Assert.Single(details.GetProperty("comments").EnumerateArray());

        using var activityResponse = await client.GetAsync(
            new Uri("/api/v1/activity?limit=20", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, activityResponse.StatusCode);
        var activity = await ReadJsonAsync(activityResponse);
        Assert.Contains(activity.EnumerateArray(), entry =>
            entry.GetProperty("eventType").GetString() == "comment.created");
    }

    [Fact]
    public async Task InvitationIsSingleUseAndRolesAreEnforced()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        var ownerCsrf = await BootstrapAsync(owner);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", ownerCsrf);
        var project = await PostAndReadAsync(
            owner,
            "/api/v1/projects",
            new { name = "Collaboration", key = "TEAM" });

        var invitation = await PostAndReadAsync(
            owner,
            "/api/v1/invitations",
            new { email = "member@cytask.local", role = "member" });
        var token = invitation.GetProperty("token").GetString()!;

        using var member = factory.CreateClient();
        using var previewResponse = await member.PostAsJsonAsync(
            new Uri("/api/v1/invitations/preview", UriKind.Relative),
            new { token },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, previewResponse.StatusCode);
        var preview = await ReadJsonAsync(previewResponse);
        Assert.Equal("CyTask Studio", preview.GetProperty("organizationName").GetString());

        using var acceptResponse = await member.PostAsJsonAsync(
            new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new
            {
                token,
                displayName = "CyTask Member",
                password = "member password is strong"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, acceptResponse.StatusCode);
        var memberSession = await ReadJsonAsync(acceptResponse);
        Assert.Equal("member", memberSession.GetProperty("role").GetString());
        member.DefaultRequestHeaders.Add(
            "X-CSRF-Token", memberSession.GetProperty("csrfToken").GetString());

        using var membersResponse = await member.GetAsync(
            new Uri("/api/v1/members", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, membersResponse.StatusCode);
        var members = await ReadJsonAsync(membersResponse);
        Assert.Equal(2, members.GetArrayLength());

        using var forbiddenProject = await member.PostAsJsonAsync(
            new Uri("/api/v1/projects", UriKind.Relative),
            new { name = "Interdit", key = "NO" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenProject.StatusCode);

        var projectId = project.GetProperty("id").GetGuid();
        var task = await PostAndReadAsync(
            member,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Contribution membre", description = "Autorisée" });
        Assert.Equal("TEAM-1", task.GetProperty("key").GetString());

        using var reusedInvitation = await factory.CreateClient().PostAsJsonAsync(
            new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new
            {
                token,
                displayName = "Another Member",
                password = "another strong password"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, reusedInvitation.StatusCode);
    }

    [Fact]
    public async Task ViewerCanReadButCannotMutate()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        var ownerCsrf = await BootstrapAsync(owner);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", ownerCsrf);
        var project = await PostAndReadAsync(
            owner,
            "/api/v1/projects",
            new { name = "Lecture", key = "READ" });
        var invitation = await PostAndReadAsync(
            owner,
            "/api/v1/invitations",
            new { email = "viewer@cytask.local", role = "viewer" });

        using var viewer = factory.CreateClient();
        using var acceptResponse = await viewer.PostAsJsonAsync(
            new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new
            {
                token = invitation.GetProperty("token").GetString(),
                displayName = "CyTask Viewer",
                password = "viewer password is strong"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, acceptResponse.StatusCode);
        var session = await ReadJsonAsync(acceptResponse);
        viewer.DefaultRequestHeaders.Add("X-CSRF-Token", session.GetProperty("csrfToken").GetString());

        var projectId = project.GetProperty("id").GetGuid();
        using var readResponse = await viewer.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/tasks", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, readResponse.StatusCode);

        using var writeResponse = await viewer.PostAsJsonAsync(
            new Uri($"/api/v1/projects/{projectId}/tasks", UriKind.Relative),
            new { title = "Interdit", description = "" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, writeResponse.StatusCode);

        using var exportResponse = await viewer.GetAsync(
            new Uri("/api/v1/export", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, exportResponse.StatusCode);
    }

    [Fact]
    public async Task SearchAndExportStayInsideTheAuthenticatedWorkspace()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Sauvegarde export", key = "BACK" });
        _ = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{project.GetProperty("id").GetGuid()}/tasks",
            new { title = "Exporter les données", description = "Archive JSON cohérente" });

        using var searchResponse = await client.GetAsync(
            new Uri("/api/v1/search?q=export&limit=10", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, searchResponse.StatusCode);
        var hits = await ReadJsonAsync(searchResponse);
        Assert.Contains(hits.EnumerateArray(), hit => hit.GetProperty("key").GetString() == "BACK-1");

        using var exportResponse = await client.GetAsync(
            new Uri("/api/v1/export", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, exportResponse.StatusCode);
        Assert.Equal("no-store", exportResponse.Headers.CacheControl?.ToString());
        Assert.StartsWith("cytask-export-", exportResponse.Content.Headers.ContentDisposition?.FileName);
        var export = await ReadJsonAsync(exportResponse);
        Assert.Equal(1, export.GetProperty("formatVersion").GetInt32());
        Assert.Single(export.GetProperty("projects").EnumerateArray());
        Assert.Single(export.GetProperty("tasks").EnumerateArray());
    }

    [Fact]
    public async Task TaskUpdatesRejectStaleRevisions()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        using var membersResponse = await client.GetAsync(
            new Uri("/api/v1/members", UriKind.Relative), TestContext.Current.CancellationToken);
        var members = await ReadJsonAsync(membersResponse);
        var ownerId = Assert.Single(members.EnumerateArray()).GetProperty("userId").GetGuid();
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Révisions", key = "REV" });
        var task = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{project.GetProperty("id").GetGuid()}/tasks",
            new { title = "Version initiale", description = "v1" });
        var taskId = task.GetProperty("id").GetGuid();

        using var update = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Version à jour",
                description = "v2",
                status = "in_progress",
                priority = "urgent",
                dueAt = "2026-10-01T09:30:00Z",
                assigneeId = ownerId,
                expectedRevision = 1
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await ReadJsonAsync(update);
        Assert.Equal(2, updated.GetProperty("revision").GetInt64());
        Assert.Equal("urgent", updated.GetProperty("priority").GetString());
        Assert.Equal(
            DateTimeOffset.Parse("2026-10-01T09:30:00Z", CultureInfo.InvariantCulture),
            updated.GetProperty("dueAt").GetDateTimeOffset());
        Assert.Equal(ownerId, updated.GetProperty("assigneeId").GetGuid());

        using var invalidPriority = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Priorité invalide",
                description = "v3",
                status = "in_progress",
                priority = "critical",
                expectedRevision = 2
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalidPriority.StatusCode);

        using var legacyUpdate = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Client sans champs de planification",
                description = "v3",
                status = "blocked",
                expectedRevision = 2
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacyUpdate.StatusCode);
        var legacyUpdated = await ReadJsonAsync(legacyUpdate);
        Assert.Equal(3, legacyUpdated.GetProperty("revision").GetInt64());
        Assert.Equal("urgent", legacyUpdated.GetProperty("priority").GetString());
        Assert.Equal(
            DateTimeOffset.Parse("2026-10-01T09:30:00Z", CultureInfo.InvariantCulture),
            legacyUpdated.GetProperty("dueAt").GetDateTimeOffset());
        Assert.Equal(ownerId, legacyUpdated.GetProperty("assigneeId").GetGuid());

        using var foreignAssignee = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Assignation interdite",
                description = "v4",
                status = "blocked",
                assigneeId = Guid.CreateVersion7(),
                expectedRevision = 3
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, foreignAssignee.StatusCode);

        using var unassign = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Tâche non assignée",
                description = "v4",
                status = "blocked",
                priority = "urgent",
                dueAt = "2026-10-01T09:30:00Z",
                assigneeId = (Guid?)null,
                expectedRevision = 3
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, unassign.StatusCode);
        var unassigned = await ReadJsonAsync(unassign);
        Assert.Equal(4, unassigned.GetProperty("revision").GetInt64());
        Assert.Equal(JsonValueKind.Null, unassigned.GetProperty("assigneeId").ValueKind);
        Assert.Equal(JsonValueKind.Null, unassigned.GetProperty("assigneeName").ValueKind);

        using var stale = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            new
            {
                title = "Écrasement obsolète",
                description = "stale",
                status = "done",
                expectedRevision = 1
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var conflict = await ReadJsonAsync(stale);
        Assert.Equal(4, conflict.GetProperty("task").GetProperty("revision").GetInt64());
    }

    [Fact]
    public async Task TaskDependenciesRejectSelfReferencesAndCycles()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Dépendances", key = "DEP" });
        var projectId = project.GetProperty("id").GetGuid();
        var first = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Première", description = "" });
        var second = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Deuxième", description = "" });
        var third = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Troisième", description = "" });
        var firstId = first.GetProperty("id").GetGuid();
        var secondId = second.GetProperty("id").GetGuid();
        var thirdId = third.GetProperty("id").GetGuid();

        using var firstDependency = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{firstId}/dependencies", UriKind.Relative),
            new { dependsOnTaskId = secondId },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, firstDependency.StatusCode);

        using var duplicate = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{firstId}/dependencies", UriKind.Relative),
            new { dependsOnTaskId = secondId },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, duplicate.StatusCode);

        using var secondDependency = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{secondId}/dependencies", UriKind.Relative),
            new { dependsOnTaskId = thirdId },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, secondDependency.StatusCode);

        using var cycle = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{thirdId}/dependencies", UriKind.Relative),
            new { dependsOnTaskId = firstId },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, cycle.StatusCode);

        using var self = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{firstId}/dependencies", UriKind.Relative),
            new { dependsOnTaskId = firstId },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, self.StatusCode);

        using var overviewResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{secondId}/dependencies", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, overviewResponse.StatusCode);
        var overview = await ReadJsonAsync(overviewResponse);
        Assert.Equal("DEP-3", Assert.Single(overview.GetProperty("dependsOn").EnumerateArray())
            .GetProperty("key").GetString());
        Assert.Equal("DEP-1", Assert.Single(overview.GetProperty("blocking").EnumerateArray())
            .GetProperty("key").GetString());

        using var removed = await client.DeleteAsync(
            new Uri($"/api/v1/tasks/{firstId}/dependencies/{secondId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, removed.StatusCode);
    }

    [Fact]
    public async Task AttachmentChunksAreVerifiedAndQuarantined()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var bytes = new byte[]
        {
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
            0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52
        };
        var sha256 = Sha256(bytes);

        var upload = await PostAndReadAsync(
            client,
            $"/api/v1/tasks/{taskId}/attachment-uploads",
            new
            {
                fileName = "capture.png",
                contentType = "image/png",
                sizeBytes = bytes.Length,
                sha256,
                optimizedLocally = true
            });
        var uploadId = upload.GetProperty("id").GetGuid();

        using var chunkRequest = new HttpRequestMessage(
            HttpMethod.Put, $"/api/v1/attachment-uploads/{uploadId}/chunks/0");
        chunkRequest.Headers.Add("X-Chunk-SHA256", sha256);
        chunkRequest.Content = new ByteArrayContent(bytes);
        chunkRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var chunkResponse = await client.SendAsync(
            chunkRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);

        using var repeatedChunkRequest = new HttpRequestMessage(
            HttpMethod.Put, $"/api/v1/attachment-uploads/{uploadId}/chunks/0");
        repeatedChunkRequest.Headers.Add("X-Chunk-SHA256", sha256);
        repeatedChunkRequest.Content = new ByteArrayContent(bytes);
        repeatedChunkRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var repeatedChunkResponse = await client.SendAsync(
            repeatedChunkRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, repeatedChunkResponse.StatusCode);

        using var completeResponse = await client.PostAsync(
            new Uri($"/api/v1/attachment-uploads/{uploadId}/complete", UriKind.Relative),
            null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        var attachment = await ReadJsonAsync(completeResponse);
        Assert.Equal("quarantined", attachment.GetProperty("status").GetString());
        Assert.Equal("image/png", attachment.GetProperty("detectedContentType").GetString());

        using var listResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachments", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, listResponse.StatusCode);
        var attachments = await ReadJsonAsync(listResponse);
        Assert.Single(attachments.EnumerateArray());

        using var rawResponse = await client.GetAsync(
            new Uri($"/api/v1/attachments/{attachment.GetProperty("id").GetGuid()}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, rawResponse.StatusCode);
    }

    [Fact]
    public async Task ReviewedImageBecomesDownloadableWithItsRealContentType()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var bytes = SinglePixelPng();

        var uploaded = await UploadAttachmentAsync(client, taskId, "pixel.png", "image/png", bytes);
        var attachmentId = uploaded.GetProperty("id").GetGuid();
        Assert.Equal("quarantined", uploaded.GetProperty("status").GetString());

        using var beforeReview = await client.GetAsync(
            new Uri($"/api/v1/attachments/{attachmentId}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, beforeReview.StatusCode);

        await factory.ReviewAttachmentsAsync();

        var reviewed = await FindAttachmentAsync(client, taskId, attachmentId);
        Assert.Equal("available", reviewed.GetProperty("status").GetString());
        Assert.Equal("image/png", reviewed.GetProperty("detectedContentType").GetString());
        Assert.Equal(1, reviewed.GetProperty("width").GetInt32());
        Assert.Equal(1, reviewed.GetProperty("height").GetInt32());

        using var download = await client.GetAsync(
            new Uri($"/api/v1/attachments/{attachmentId}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("image/png", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
        Assert.Equal("nosniff", download.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal(
            bytes,
            await download.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task ReviewRejectsATruncatedImageAndKeepsItUndownloadable()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var bytes = SinglePixelPng()[..24];

        var uploaded = await UploadAttachmentAsync(client, taskId, "coupe.png", "image/png", bytes);
        var attachmentId = uploaded.GetProperty("id").GetGuid();
        await factory.ReviewAttachmentsAsync();

        var reviewed = await FindAttachmentAsync(client, taskId, attachmentId);
        Assert.Equal("rejected", reviewed.GetProperty("status").GetString());
        Assert.False(string.IsNullOrWhiteSpace(reviewed.GetProperty("rejectionReason").GetString()));

        using var download = await client.GetAsync(
            new Uri($"/api/v1/attachments/{attachmentId}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, download.StatusCode);
    }

    [Fact]
    public async Task ReviewRejectsContentThatDoesNotMatchTheDeclaredType()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);

        var uploaded = await UploadAttachmentAsync(
            client, taskId, "capture.jpg", "image/jpeg", SinglePixelPng());
        await factory.ReviewAttachmentsAsync();

        var reviewed = await FindAttachmentAsync(client, taskId, uploaded.GetProperty("id").GetGuid());
        Assert.Equal("rejected", reviewed.GetProperty("status").GetString());
        Assert.Contains(
            "image/png",
            reviewed.GetProperty("rejectionReason").GetString(),
            StringComparison.Ordinal);
    }

    [Fact]
    public async Task ReviewAcceptsAGenericFileButNeverServesItAsAMediaType()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var bytes = Encoding.UTF8.GetBytes("<html><script>alert(1)</script></html>");

        var uploaded = await UploadAttachmentAsync(client, taskId, "note.html", "text/html", bytes);
        var attachmentId = uploaded.GetProperty("id").GetGuid();
        await factory.ReviewAttachmentsAsync();

        var reviewed = await FindAttachmentAsync(client, taskId, attachmentId);
        Assert.Equal("available", reviewed.GetProperty("status").GetString());

        using var download = await client.GetAsync(
            new Uri($"/api/v1/attachments/{attachmentId}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("application/octet-stream", download.Content.Headers.ContentType?.MediaType);
        Assert.Equal("attachment", download.Content.Headers.ContentDisposition?.DispositionType);
    }

    [Fact]
    public async Task AttachmentContentStaysInsideItsOrganization()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        var csrf = await BootstrapAsync(owner);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(owner);
        var uploaded = await UploadAttachmentAsync(
            owner, taskId, "pixel.png", "image/png", SinglePixelPng());
        await factory.ReviewAttachmentsAsync();

        using var stranger = factory.CreateClient();
        using var download = await stranger.GetAsync(
            new Uri($"/api/v1/attachments/{uploaded.GetProperty("id").GetGuid()}/content", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, download.StatusCode);
    }

    [Fact]
    public async Task AttachmentWithWrongFullFingerprintIsRejected()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var declaredBytes = "expected media"u8.ToArray();
        var uploadedBytes = "modified media"u8.ToArray();

        var upload = await PostAndReadAsync(
            client,
            $"/api/v1/tasks/{taskId}/attachment-uploads",
            new
            {
                fileName = "proof.bin",
                contentType = "application/octet-stream",
                sizeBytes = uploadedBytes.Length,
                sha256 = Sha256(declaredBytes),
                optimizedLocally = false
            });
        var uploadId = upload.GetProperty("id").GetGuid();
        using var chunkRequest = new HttpRequestMessage(
            HttpMethod.Put, $"/api/v1/attachment-uploads/{uploadId}/chunks/0");
        chunkRequest.Headers.Add("X-Chunk-SHA256", Sha256(uploadedBytes));
        chunkRequest.Content = new ByteArrayContent(uploadedBytes);
        chunkRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var chunkResponse = await client.SendAsync(
            chunkRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);

        using var completeResponse = await client.PostAsync(
            new Uri($"/api/v1/attachment-uploads/{uploadId}/complete", UriKind.Relative),
            null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, completeResponse.StatusCode);

        using var listResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachments", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var attachments = await ReadJsonAsync(listResponse);
        Assert.Equal("rejected", attachments[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task GitReferenceCanBeLinkedWithoutGivingTheServerRepositoryAccess()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var body = new
        {
            provider = "github",
            repository = "cytask/cytask",
            referenceType = "commit",
            referenceValue = "0123456789abcdef",
            label = "Sécuriser le pipeline média",
            webUrl = "https://github.com/cytask/cytask/commit/0123456789abcdef"
        };

        var reference = await PostAndReadAsync(
            client, $"/api/v1/tasks/{taskId}/external-references", body);
        Assert.Equal("commit", reference.GetProperty("referenceType").GetString());

        using var duplicate = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/external-references", UriKind.Relative),
            body,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        using var insecure = await client.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/external-references", UriKind.Relative),
            new
            {
                provider = "git",
                repository = "local/repository",
                referenceType = "branch",
                referenceValue = "feature/media",
                label = "Branche média",
                webUrl = "http://git.example.test/local/repository"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, insecure.StatusCode);

        using var list = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/external-references", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, list.StatusCode);
        var references = await ReadJsonAsync(list);
        Assert.Single(references.EnumerateArray());
    }

    [Fact]
    public async Task TaskCreationIsPublishedInRealTime()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Temps réel", key = "RT" });
        var projectId = project.GetProperty("id").GetGuid();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var eventRequest = new HttpRequestMessage(HttpMethod.Get, "/api/v1/events");
        using var eventResponse = await client.SendAsync(
            eventRequest,
            HttpCompletionOption.ResponseHeadersRead,
            timeout.Token);
        Assert.Equal(HttpStatusCode.OK, eventResponse.StatusCode);
        await using var stream = await eventResponse.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        Assert.Equal("event: ready", await reader.ReadLineAsync(timeout.Token));
        _ = await reader.ReadLineAsync(timeout.Token);
        _ = await reader.ReadLineAsync(timeout.Token);

        _ = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Diffuser la création", description = "" });

        string? line;
        do
        {
            line = await reader.ReadLineAsync(timeout.Token);
        } while (line is not null && !string.Equals(line, "event: task.created", StringComparison.Ordinal));

        Assert.Equal("event: task.created", line);
    }

    private static object CreateBootstrapRequest() => new
    {
        email = "owner@cytask.local",
        displayName = "CyTask Owner",
        password = "correct horse battery staple",
        organizationName = "CyTask Studio"
    };

    private static async Task<string> BootstrapAsync(HttpClient client)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri("/api/v1/bootstrap", UriKind.Relative),
            CreateBootstrapRequest(),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var session = await ReadJsonAsync(response);
        return session.GetProperty("csrfToken").GetString()!;
    }

    private static async Task<JsonElement> PostAndReadAsync(HttpClient client, string path, object body)
    {
        using var response = await client.PostAsJsonAsync(
            new Uri(path, UriKind.Relative), body, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        return await ReadJsonAsync(response);
    }

    private static Task<HttpResponseMessage> PostTokenAsync(
        HttpClient client,
        string code,
        string redirectUri,
        string verifier) =>
        client.PostAsync(
            new Uri("/api/v1/oauth/token", UriKind.Relative),
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "authorization_code",
                ["client_id"] = "cytask-unreal",
                ["code"] = code,
                ["redirect_uri"] = redirectUri,
                ["code_verifier"] = verifier
            }),
            TestContext.Current.CancellationToken);

    private static async Task<Guid> CreateTaskForAttachmentAsync(HttpClient client)
    {
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Médias", key = "MEDIA" });
        var task = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{project.GetProperty("id").GetGuid()}/tasks",
            new { title = "Ajouter une capture", description = "" });
        return task.GetProperty("id").GetGuid();
    }

    private static async Task<JsonElement> UploadAttachmentAsync(
        HttpClient client, Guid taskId, string fileName, string contentType, byte[] bytes)
    {
        var sha256 = Sha256(bytes);
        var upload = await PostAndReadAsync(
            client,
            $"/api/v1/tasks/{taskId}/attachment-uploads",
            new { fileName, contentType, sizeBytes = bytes.Length, sha256, optimizedLocally = false });
        var uploadId = upload.GetProperty("id").GetGuid();

        using var chunkRequest = new HttpRequestMessage(
            HttpMethod.Put, $"/api/v1/attachment-uploads/{uploadId}/chunks/0");
        chunkRequest.Headers.Add("X-Chunk-SHA256", sha256);
        chunkRequest.Content = new ByteArrayContent(bytes);
        chunkRequest.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var chunkResponse = await client.SendAsync(chunkRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);

        using var completeResponse = await client.PostAsync(
            new Uri($"/api/v1/attachment-uploads/{uploadId}/complete", UriKind.Relative),
            null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        return await ReadJsonAsync(completeResponse);
    }

    private static async Task<JsonElement> FindAttachmentAsync(HttpClient client, Guid taskId, Guid attachmentId)
    {
        using var response = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachments", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var attachments = await ReadJsonAsync(response);
        return attachments.EnumerateArray()
            .Single(attachment => attachment.GetProperty("id").GetGuid() == attachmentId);
    }

    private static byte[] SinglePixelPng() => Convert.FromBase64String(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk" +
        "+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==");

    private static string Sha256(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(TestContext.Current.CancellationToken);
        using var document = await JsonDocument.ParseAsync(
            stream, cancellationToken: TestContext.Current.CancellationToken);
        return document.RootElement.Clone();
    }

    private sealed class CyTaskApiFactory : WebApplicationFactory<Program>
    {
        private readonly string _mediaPath = Path.Combine(
            Path.GetTempPath(), "CyTask.Tests", Guid.NewGuid().ToString("N"));

        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Development");
            builder.UseSetting("CyTask:MediaStoragePath", _mediaPath);
            builder.UseSetting("CyTask:MediaReviewSeconds", "3600");
        }

        public Task<int> ReviewAttachmentsAsync() =>
            Services.GetRequiredService<AttachmentReviewService>()
                .ReviewBatchAsync(TestContext.Current.CancellationToken);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            if (Directory.Exists(_mediaPath))
            {
                Directory.Delete(_mediaPath, recursive: true);
            }
        }
    }
}
