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
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using CyTask.Api.Configuration;
using CyTask.Api.Media;
using CyTask.Api.Realtime;
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
    public async Task ProjectResourcesAndChatStayConnectedToTheirSpace()
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
            new { name = "Espace collaboratif", key = "COLLAB" });
        var projectId = project.GetProperty("id").GetGuid();

        var document = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/resources",
            new
            {
                resourceType = "document",
                name = "Guide de revue",
                body = "# Première revue",
                folderLabelId = (Guid?)null
            });
        var canvas = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/resources",
            new
            {
                resourceType = "canvas",
                name = "Moodboard",
                body = "{\"version\":1,\"items\":[]}",
                folderLabelId = (Guid?)null
            });

        var imageBytes = SinglePixelPng();
        var imageHash = Sha256(imageBytes);
        var imageUpload = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/resource-uploads",
            new
            {
                fileName = "direction-artistique.png",
                contentType = "image/png",
                sizeBytes = imageBytes.Length,
                sha256 = imageHash,
                folderLabelId = (Guid?)null
            });
        var imageUploadId = imageUpload.GetProperty("id").GetGuid();
        using (var chunkRequest = new HttpRequestMessage(
                   HttpMethod.Put, $"/api/v1/resource-uploads/{imageUploadId}/chunks/0"))
        {
            chunkRequest.Headers.Add("X-Chunk-SHA256", imageHash);
            chunkRequest.Content = new ByteArrayContent(imageBytes);
            chunkRequest.Content.Headers.ContentType =
                new MediaTypeHeaderValue("application/octet-stream");
            using var chunkResponse = await client.SendAsync(
                chunkRequest, TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);
        }
        using var completeResponse = await client.PostAsync(
            new Uri($"/api/v1/resource-uploads/{imageUploadId}/complete", UriKind.Relative),
            null, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, completeResponse.StatusCode);
        var uploadedImage = await ReadJsonAsync(completeResponse);
        Assert.Equal("available", uploadedImage.GetProperty("status").GetString());
        Assert.Equal("image/png", uploadedImage.GetProperty("detectedContentType").GetString());

        using var resourcesResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/resources", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, resourcesResponse.StatusCode);
        var resources = await ReadJsonAsync(resourcesResponse);
        Assert.Equal(3, resources.GetArrayLength());
        Assert.Contains(resources.EnumerateArray(), item =>
            item.GetProperty("id").GetGuid() == canvas.GetProperty("id").GetGuid()
            && item.GetProperty("resourceType").GetString() == "canvas");

        using var updateResponse = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/resources/{document.GetProperty("id").GetGuid()}", UriKind.Relative),
            new
            {
                name = "Guide de revue v2",
                body = "# Revue validée",
                folderLabelId = (Guid?)null,
                expectedRevision = document.GetProperty("revision").GetInt64()
            }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, updateResponse.StatusCode);
        var updatedDocument = await ReadJsonAsync(updateResponse);
        Assert.Equal(2, updatedDocument.GetProperty("revision").GetInt64());

        var channel = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/chat/channels",
            new { name = "Général", topic = "Coordination de l’équipe" });
        var message = await PostAndReadAsync(
            client,
            $"/api/v1/chat/channels/{channel.GetProperty("id").GetGuid()}/messages",
            new
            {
                body = "@CyTask Owner voici le guide de revue.",
                resourceIds = new[] { document.GetProperty("id").GetGuid(), uploadedImage.GetProperty("id").GetGuid() },
                mentionedUserIds = new[] { ownerId }
            });
        Assert.Equal("CyTask Owner", message.GetProperty("authorName").GetString());
        Assert.Equal(2, message.GetProperty("resources").GetArrayLength());
        Assert.Equal(ownerId,
            Assert.Single(message.GetProperty("mentionedUserIds").EnumerateArray()).GetGuid());

        using var messagesResponse = await client.GetAsync(
            new Uri($"/api/v1/chat/channels/{channel.GetProperty("id").GetGuid()}/messages",
                UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, messagesResponse.StatusCode);
        var messages = await ReadJsonAsync(messagesResponse);
        Assert.Equal(message.GetProperty("id").GetGuid(),
            Assert.Single(messages.EnumerateArray()).GetProperty("id").GetGuid());
    }

    [Fact]
    public async Task PrivateChatGroupsOnlyExposeMessagesToInvitedMembers()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        var ownerCsrf = await BootstrapAsync(owner);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", ownerCsrf);
        var project = await PostAndReadAsync(
            owner,
            "/api/v1/projects",
            new { name = "Groupes privés", key = "GROUP" });
        var projectId = project.GetProperty("id").GetGuid();

        var invitation = await PostAndReadAsync(
            owner,
            "/api/v1/invitations",
            new { email = "group-member@cytask.local", role = "member" });
        using var member = factory.CreateClient();
        using var acceptResponse = await member.PostAsJsonAsync(
            new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new
            {
                token = invitation.GetProperty("token").GetString(),
                displayName = "Group Member",
                password = "group member password is strong"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, acceptResponse.StatusCode);
        var memberSession = await ReadJsonAsync(acceptResponse);
        var memberId = memberSession.GetProperty("userId").GetGuid();
        member.DefaultRequestHeaders.Add(
            "X-CSRF-Token", memberSession.GetProperty("csrfToken").GetString());

        var hiddenGroup = await PostAndReadAsync(
            owner,
            $"/api/v1/projects/{projectId}/chat/channels",
            new
            {
                name = "Direction",
                topic = "Créateurs uniquement",
                channelType = "group",
                memberIds = Array.Empty<Guid>()
            });
        Assert.Equal("group", hiddenGroup.GetProperty("channelType").GetString());
        Assert.Single(hiddenGroup.GetProperty("memberIds").EnumerateArray());

        var sharedGroup = await PostAndReadAsync(
            owner,
            $"/api/v1/projects/{projectId}/chat/channels",
            new
            {
                name = "Production",
                topic = "Groupe partagé",
                channelType = "group",
                memberIds = new[] { memberId }
            });
        Assert.Contains(sharedGroup.GetProperty("memberIds").EnumerateArray(),
            item => item.GetGuid() == memberId);

        using var memberChannelsResponse = await member.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/chat/channels", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, memberChannelsResponse.StatusCode);
        var memberChannels = await ReadJsonAsync(memberChannelsResponse);
        Assert.DoesNotContain(memberChannels.EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == hiddenGroup.GetProperty("id").GetGuid());
        Assert.Contains(memberChannels.EnumerateArray(),
            item => item.GetProperty("id").GetGuid() == sharedGroup.GetProperty("id").GetGuid());

        using var hiddenMessages = await member.GetAsync(
            new Uri($"/api/v1/chat/channels/{hiddenGroup.GetProperty("id").GetGuid()}/messages",
                UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, hiddenMessages.StatusCode);
        using var sharedMessages = await member.GetAsync(
            new Uri($"/api/v1/chat/channels/{sharedGroup.GetProperty("id").GetGuid()}/messages",
                UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, sharedMessages.StatusCode);
    }

    [Fact]
    public async Task TaskPagesUseStableCursorsAndServerSideFilters()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Pagination", key = "PAGE" });
        var projectId = project.GetProperty("id").GetGuid();

        var created = new List<JsonElement>();
        foreach (var (title, priority) in new[]
                 {
                     ("Alpha", "normal"),
                     ("Beta", "low"),
                     ("Gamma", "high"),
                     ("Delta", "urgent"),
                     ("Epsilon", "low")
                 })
        {
            created.Add(await PostAndReadAsync(
                client,
                $"/api/v1/projects/{projectId}/tasks",
                new { title, description = $"Description {title}", priority }));
        }

        var label = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/labels",
            new { name = "Gameplay", color = "#34AADC" });
        var labelId = label.GetProperty("id").GetGuid();
        using var assignment = await client.PutAsync(
            new Uri(
                $"/api/v1/tasks/{created[2].GetProperty("id").GetGuid()}/labels/{labelId}",
                UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, assignment.StatusCode);

        using var firstResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?sort=key&limit=2",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, firstResponse.StatusCode);
        var first = await ReadJsonAsync(firstResponse);
        Assert.Equal(5, first.GetProperty("totalCount").GetInt32());
        Assert.Equal(
            ["PAGE-1", "PAGE-2"],
            first.GetProperty("items").EnumerateArray()
                .Select(task => task.GetProperty("key").GetString()!)
                .ToArray());
        var firstCursor = first.GetProperty("nextCursor").GetString();
        Assert.False(string.IsNullOrWhiteSpace(firstCursor));

        using var secondResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?sort=key&limit=2&cursor={Uri.EscapeDataString(firstCursor!)}",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, secondResponse.StatusCode);
        var second = await ReadJsonAsync(secondResponse);
        Assert.Equal(
            ["PAGE-3", "PAGE-4"],
            second.GetProperty("items").EnumerateArray()
                .Select(task => task.GetProperty("key").GetString()!)
                .ToArray());
        var secondCursor = second.GetProperty("nextCursor").GetString();

        using var thirdResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?sort=key&limit=2&cursor={Uri.EscapeDataString(secondCursor!)}",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, thirdResponse.StatusCode);
        var third = await ReadJsonAsync(thirdResponse);
        Assert.Equal(
            ["PAGE-5"],
            third.GetProperty("items").EnumerateArray()
                .Select(task => task.GetProperty("key").GetString()!)
                .ToArray());
        Assert.Equal(JsonValueKind.Null, third.GetProperty("nextCursor").ValueKind);

        using var filteredResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?query=description%20gamma&priority=high&label={labelId}",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, filteredResponse.StatusCode);
        var filtered = await ReadJsonAsync(filteredResponse);
        Assert.Equal(1, filtered.GetProperty("totalCount").GetInt32());
        Assert.Equal(
            "PAGE-3",
            Assert.Single(filtered.GetProperty("items").EnumerateArray())
                .GetProperty("key").GetString());

        using var withoutLabelResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?label=none",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        var withoutLabel = await ReadJsonAsync(withoutLabelResponse);
        Assert.Equal(4, withoutLabel.GetProperty("totalCount").GetInt32());

        using var optionsResponse = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-options",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, optionsResponse.StatusCode);
        var options = await ReadJsonAsync(optionsResponse);
        Assert.Equal(5, options.GetArrayLength());
        Assert.Equal("PAGE-1", options[0].GetProperty("key").GetString());
        Assert.False(options[0].TryGetProperty("description", out _));

        using var invalidCursor = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?sort=key&cursor=not-a-cursor",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidCursor.StatusCode);
        using var invalidLimit = await client.GetAsync(
            new Uri(
                $"/api/v1/projects/{projectId}/task-page?limit=101",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.UnprocessableEntity, invalidLimit.StatusCode);
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
        using var forbiddenLabel = await viewer.PostAsJsonAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            new { name = "Interdit", color = "#FF0000" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, forbiddenLabel.StatusCode);



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
        Assert.Equal(4, export.GetProperty("formatVersion").GetInt32());
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
    public async Task ChecklistItemsSupportCompletionConcurrencyAndTaskScoping()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Checklist", key = "CHECK" });
        var projectId = project.GetProperty("id").GetGuid();
        var task = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Préparer la livraison", description = "" });
        var otherTask = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Autre tâche", description = "" });
        var taskId = task.GetProperty("id").GetGuid();

        var item = await PostAndReadAsync(
            client,
            $"/api/v1/tasks/{taskId}/checklist",
            new { title = "Valider les tests" });
        var itemId = item.GetProperty("id").GetGuid();
        Assert.False(item.GetProperty("isCompleted").GetBoolean());
        Assert.Equal(0, item.GetProperty("position").GetInt32());
        Assert.Equal(1, item.GetProperty("revision").GetInt64());

        using var detailsResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, detailsResponse.StatusCode);
        var details = await ReadJsonAsync(detailsResponse);
        Assert.Equal(2, details.GetProperty("task").GetProperty("revision").GetInt64());
        Assert.Equal(
            "Valider les tests",
            Assert.Single(details.GetProperty("checklist").EnumerateArray()).GetProperty("title").GetString());

        using var update = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/checklist/{itemId}", UriKind.Relative),
            new { title = "Valider tous les tests", isCompleted = true, expectedRevision = 1 },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, update.StatusCode);
        var updated = await ReadJsonAsync(update);
        Assert.True(updated.GetProperty("isCompleted").GetBoolean());
        Assert.Equal(2, updated.GetProperty("revision").GetInt64());

        using var stale = await client.PatchAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/checklist/{itemId}", UriKind.Relative),
            new { title = "Écraser", isCompleted = false, expectedRevision = 1 },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var conflict = await ReadJsonAsync(stale);
        Assert.Equal(2, conflict.GetProperty("item").GetProperty("revision").GetInt64());

        using var wrongTask = await client.PatchAsJsonAsync(
            new Uri(
                $"/api/v1/tasks/{otherTask.GetProperty("id").GetGuid()}/checklist/{itemId}",
                UriKind.Relative),
            new { title = "Changer de tâche", isCompleted = false, expectedRevision = 2 },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, wrongTask.StatusCode);

        using var exportResponse = await client.GetAsync(
            new Uri("/api/v1/export", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, exportResponse.StatusCode);
        var export = await ReadJsonAsync(exportResponse);
        Assert.Equal(4, export.GetProperty("formatVersion").GetInt32());
        Assert.Equal(
            itemId,
            Assert.Single(export.GetProperty("checklist").EnumerateArray()).GetProperty("id").GetGuid());

        using var staleDelete = await client.DeleteAsync(
            new Uri(
                $"/api/v1/tasks/{taskId}/checklist/{itemId}?expectedRevision=1",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, staleDelete.StatusCode);

        using var delete = await client.DeleteAsync(
            new Uri(
                $"/api/v1/tasks/{taskId}/checklist/{itemId}?expectedRevision=2",
                UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        using var finalDetailsResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var finalDetails = await ReadJsonAsync(finalDetailsResponse);
        Assert.Empty(finalDetails.GetProperty("checklist").EnumerateArray());
        Assert.Equal(4, finalDetails.GetProperty("task").GetProperty("revision").GetInt64());
    }

    [Fact]
    public async Task ProjectLabelsAreScopedAndAssignmentsAreIdempotent()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Labels", key = "LAB" });
        var projectId = project.GetProperty("id").GetGuid();
        var task = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Classer cette tâche", description = "" });
        var taskId = task.GetProperty("id").GetGuid();

        using var emptyResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, emptyResponse.StatusCode);
        var empty = await ReadJsonAsync(emptyResponse);
        Assert.Empty(empty.GetProperty("labels").EnumerateArray());
        Assert.Empty(empty.GetProperty("assignments").EnumerateArray());
        using var invalidLabel = await client.PostAsJsonAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            new { name = (string?)null, color = (string?)null },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalidLabel.StatusCode);



        var label = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/labels",
            new { name = "Gameplay", color = "#34aadc" });
        var labelId = label.GetProperty("id").GetGuid();
        Assert.Equal("#34AADC", label.GetProperty("color").GetString());
        var childLabel = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/labels",
            new { name = "NPC Physics", color = "#F97316", parentLabelId = labelId });
        var childLabelId = childLabel.GetProperty("id").GetGuid();
        Assert.Equal(labelId, childLabel.GetProperty("parentLabelId").GetGuid());

        using var invalidParent = await client.PostAsJsonAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            new { name = "Orphelin", color = "#112233", parentLabelId = Guid.NewGuid() },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, invalidParent.StatusCode);


        using var duplicate = await client.PostAsJsonAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            new { name = "gameplay", color = "#FF00FF" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode);

        using var assignmentResponse = await client.PutAsync(
            new Uri($"/api/v1/tasks/{taskId}/labels/{labelId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, assignmentResponse.StatusCode);
        var assignment = await ReadJsonAsync(assignmentResponse);
        Assert.Equal(taskId, assignment.GetProperty("taskId").GetGuid());
        Assert.Equal(labelId, assignment.GetProperty("labelId").GetGuid());

        using var duplicateAssignment = await client.PutAsync(
            new Uri($"/api/v1/tasks/{taskId}/labels/{labelId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, duplicateAssignment.StatusCode);

        using var overviewResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var overview = await ReadJsonAsync(overviewResponse);
        Assert.Equal(2, overview.GetProperty("labels").GetArrayLength());
        Assert.Single(overview.GetProperty("assignments").EnumerateArray());

        var otherProject = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Autre projet", key = "OTHER" });
        var otherLabel = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{otherProject.GetProperty("id").GetGuid()}/labels",
            new { name = "Externe", color = "#22AA66" });
        using var crossProject = await client.PutAsync(
            new Uri(
                $"/api/v1/tasks/{taskId}/labels/{otherLabel.GetProperty("id").GetGuid()}",
                UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, crossProject.StatusCode);

        using var exportResponse = await client.GetAsync(
            new Uri("/api/v1/export", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var export = await ReadJsonAsync(exportResponse);
        Assert.Equal(4, export.GetProperty("formatVersion").GetInt32());
        Assert.Equal(3, export.GetProperty("projectLabels").GetArrayLength());
        Assert.Single(export.GetProperty("taskLabels").EnumerateArray());

        using var remove = await client.DeleteAsync(
            new Uri($"/api/v1/tasks/{taskId}/labels/{labelId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        using var removeAgain = await client.DeleteAsync(
            new Uri($"/api/v1/tasks/{taskId}/labels/{labelId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, removeAgain.StatusCode);

        using var assignAgain = await client.PutAsync(
            new Uri($"/api/v1/tasks/{taskId}/labels/{labelId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, assignAgain.StatusCode);
        using var deleteLabel = await client.DeleteAsync(
            new Uri($"/api/v1/projects/{projectId}/labels/{labelId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, deleteLabel.StatusCode);

        using var promotedOverviewResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var promotedOverview = await ReadJsonAsync(promotedOverviewResponse);
        var promotedChild = Assert.Single(promotedOverview.GetProperty("labels").EnumerateArray());
        Assert.Equal(childLabelId, promotedChild.GetProperty("id").GetGuid());
        Assert.Equal(JsonValueKind.Null, promotedChild.GetProperty("parentLabelId").ValueKind);
        Assert.Empty(promotedOverview.GetProperty("assignments").EnumerateArray());

        using var deleteChild = await client.DeleteAsync(
            new Uri($"/api/v1/projects/{projectId}/labels/{childLabelId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, deleteChild.StatusCode);
        using var finalOverviewResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/labels", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var finalOverview = await ReadJsonAsync(finalOverviewResponse);
        Assert.Empty(finalOverview.GetProperty("labels").EnumerateArray());
    }

    [Fact]
    public async Task TaskHierarchyIsProjectScopedIdempotentAndAcyclic()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Sous-tâches", key = "SUB" });
        var projectId = project.GetProperty("id").GetGuid();
        var parent = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Tâche parente", description = "" });
        var child = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Sous-tâche", description = "" });
        var grandchild = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Sous-sous-tâche", description = "" });
        var parentId = parent.GetProperty("id").GetGuid();
        var childId = child.GetProperty("id").GetGuid();
        var grandchildId = grandchild.GetProperty("id").GetGuid();

        using var emptyResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/task-hierarchy", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, emptyResponse.StatusCode);
        var empty = await ReadJsonAsync(emptyResponse);
        Assert.Empty(empty.GetProperty("relations").EnumerateArray());

        using var setChildParent = await client.PutAsync(
            new Uri($"/api/v1/tasks/{childId}/parent/{parentId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, setChildParent.StatusCode);
        var relation = await ReadJsonAsync(setChildParent);
        Assert.Equal(childId, relation.GetProperty("taskId").GetGuid());
        Assert.Equal(parentId, relation.GetProperty("parentTaskId").GetGuid());

        using var setAgain = await client.PutAsync(
            new Uri($"/api/v1/tasks/{childId}/parent/{parentId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, setAgain.StatusCode);

        using var setGrandchildParent = await client.PutAsync(
            new Uri($"/api/v1/tasks/{grandchildId}/parent/{childId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, setGrandchildParent.StatusCode);

        using var selfParent = await client.PutAsync(
            new Uri($"/api/v1/tasks/{parentId}/parent/{parentId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, selfParent.StatusCode);

        using var cycle = await client.PutAsync(
            new Uri($"/api/v1/tasks/{parentId}/parent/{grandchildId}", UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Conflict, cycle.StatusCode);

        var otherProject = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Hiérarchie externe", key = "EXT" });
        var otherTask = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{otherProject.GetProperty("id").GetGuid()}/tasks",
            new { title = "Autre projet", description = "" });
        using var crossProject = await client.PutAsync(
            new Uri(
                $"/api/v1/tasks/{childId}/parent/{otherTask.GetProperty("id").GetGuid()}",
                UriKind.Relative),
            content: null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, crossProject.StatusCode);

        using var hierarchyResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/task-hierarchy", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var hierarchy = await ReadJsonAsync(hierarchyResponse);
        Assert.Equal(2, hierarchy.GetProperty("relations").GetArrayLength());

        using var exportResponse = await client.GetAsync(
            new Uri("/api/v1/export", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var export = await ReadJsonAsync(exportResponse);
        Assert.Equal(4, export.GetProperty("formatVersion").GetInt32());
        Assert.Equal(2, export.GetProperty("taskParents").GetArrayLength());

        using var remove = await client.DeleteAsync(
            new Uri($"/api/v1/tasks/{childId}/parent", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, remove.StatusCode);
        using var removeAgain = await client.DeleteAsync(
            new Uri($"/api/v1/tasks/{childId}/parent", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, removeAgain.StatusCode);

        using var finalHierarchyResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/task-hierarchy", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var finalHierarchy = await ReadJsonAsync(finalHierarchyResponse);
        Assert.Single(finalHierarchy.GetProperty("relations").EnumerateArray());
        using var childResponse = await client.GetAsync(
            new Uri($"/api/v1/tasks/{childId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        var childDetails = await ReadJsonAsync(childResponse);
        Assert.Equal(3, childDetails.GetProperty("task").GetProperty("revision").GetInt64());
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
    public async Task InterruptedUploadCanResumeAndStaysPrivateToItsCreator()
    {
        await using var factory = new CyTaskApiFactory();
        using var owner = factory.CreateClient();
        var ownerCsrf = await BootstrapAsync(owner);
        owner.DefaultRequestHeaders.Add("X-CSRF-Token", ownerCsrf);
        var taskId = await CreateTaskForAttachmentAsync(owner);
        var bytes = Enumerable.Range(0, 65_539).Select(index => (byte)(index % 251)).ToArray();
        var fullSha256 = Sha256(bytes);

        var upload = await PostAndReadAsync(
            owner,
            $"/api/v1/tasks/{taskId}/attachment-uploads",
            new
            {
                fileName = "archive.bin",
                contentType = "application/octet-stream",
                sizeBytes = bytes.Length,
                sha256 = fullSha256,
                optimizedLocally = false
            });
        var uploadId = upload.GetProperty("id").GetGuid();
        Assert.Equal(65_536, upload.GetProperty("chunkSizeBytes").GetInt32());

        var firstChunk = bytes[..65_536];
        using (var chunkRequest = new HttpRequestMessage(
                   HttpMethod.Put,
                   $"/api/v1/attachment-uploads/{uploadId}/chunks/0"))
        {
            chunkRequest.Headers.Add("X-Chunk-SHA256", Sha256(firstChunk));
            chunkRequest.Content = new ByteArrayContent(firstChunk);
            chunkRequest.Content.Headers.ContentType =
                new MediaTypeHeaderValue("application/octet-stream");
            using var chunkResponse = await owner.SendAsync(
                chunkRequest,
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, chunkResponse.StatusCode);
        }

        using var activeResponse = await owner.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachment-uploads", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, activeResponse.StatusCode);
        var activeUploads = await ReadJsonAsync(activeResponse);
        var activeUpload = Assert.Single(activeUploads.EnumerateArray());
        Assert.Equal(uploadId, activeUpload.GetProperty("id").GetGuid());
        Assert.Equal(65_536, Assert.Single(activeUpload.GetProperty("chunks").EnumerateArray())
            .GetProperty("sizeBytes").GetInt64());

        var invitation = await PostAndReadAsync(
            owner,
            "/api/v1/invitations",
            new { email = "upload-member@cytask.local", role = "member" });
        using var member = factory.CreateClient();
        using var acceptResponse = await member.PostAsJsonAsync(
            new Uri("/api/v1/invitations/accept", UriKind.Relative),
            new
            {
                token = invitation.GetProperty("token").GetString(),
                displayName = "Upload Member",
                password = "upload member password"
            },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, acceptResponse.StatusCode);
        var memberSession = await ReadJsonAsync(acceptResponse);
        member.DefaultRequestHeaders.Add(
            "X-CSRF-Token",
            memberSession.GetProperty("csrfToken").GetString());

        var memberUploads = await ReadJsonAsync(await member.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachment-uploads", UriKind.Relative),
            TestContext.Current.CancellationToken));
        Assert.Empty(memberUploads.EnumerateArray());
        using var hiddenUpload = await member.GetAsync(
            new Uri($"/api/v1/attachment-uploads/{uploadId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NotFound, hiddenUpload.StatusCode);

        using (var repeatedChunk = new HttpRequestMessage(
                   HttpMethod.Put,
                   $"/api/v1/attachment-uploads/{uploadId}/chunks/0"))
        {
            repeatedChunk.Headers.Add("X-Chunk-SHA256", Sha256(firstChunk));
            repeatedChunk.Content = new ByteArrayContent(firstChunk);
            repeatedChunk.Content.Headers.ContentType =
                new MediaTypeHeaderValue("application/octet-stream");
            using var repeatedResponse = await owner.SendAsync(
                repeatedChunk,
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, repeatedResponse.StatusCode);
        }

        var lastChunk = bytes[65_536..];
        using (var lastChunkRequest = new HttpRequestMessage(
                   HttpMethod.Put,
                   $"/api/v1/attachment-uploads/{uploadId}/chunks/1"))
        {
            lastChunkRequest.Headers.Add("X-Chunk-SHA256", Sha256(lastChunk));
            lastChunkRequest.Content = new ByteArrayContent(lastChunk);
            lastChunkRequest.Content.Headers.ContentType =
                new MediaTypeHeaderValue("application/octet-stream");
            using var lastChunkResponse = await owner.SendAsync(
                lastChunkRequest,
                TestContext.Current.CancellationToken);
            Assert.Equal(HttpStatusCode.OK, lastChunkResponse.StatusCode);
        }

        using var complete = await owner.PostAsync(
            new Uri($"/api/v1/attachment-uploads/{uploadId}/complete", UriKind.Relative),
            null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, complete.StatusCode);
        var attachment = await ReadJsonAsync(complete);
        Assert.Equal("quarantined", attachment.GetProperty("status").GetString());

        var remainingUploads = await ReadJsonAsync(await owner.GetAsync(
            new Uri($"/api/v1/tasks/{taskId}/attachment-uploads", UriKind.Relative),
            TestContext.Current.CancellationToken));
        Assert.Empty(remainingUploads.EnumerateArray());
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
    public async Task ApiTokensAuthenticatePluginsWithScopeEnforcement()
    {
        await using var factory = new CyTaskApiFactory();
        using var browser = factory.CreateClient();
        var csrf = await BootstrapAsync(browser);
        browser.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(browser);

        var readToken = await PostAndReadAsync(
            browser, "/api/v1/tokens", new { name = "Lecture CI", scope = "read", expiresInDays = 30 });
        var writeToken = await PostAndReadAsync(
            browser, "/api/v1/tokens", new { name = "Robot Git", scope = "write" });
        var readSecret = readToken.GetProperty("secret").GetString()!;
        var writeSecret = writeToken.GetProperty("secret").GetString()!;
        Assert.StartsWith("cytask_pat_", readSecret, StringComparison.Ordinal);

        using var reader = factory.CreateClient();
        reader.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", readSecret);
        using var readProjects = await reader.GetAsync(
            new Uri("/api/v1/projects", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, readProjects.StatusCode);

        using var readOnlyMutation = await reader.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/comments", UriKind.Relative),
            new { body = "refusé" },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Forbidden, readOnlyMutation.StatusCode);

        using var readOnlyTokenListing = await reader.GetAsync(
            new Uri("/api/v1/tokens", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, readOnlyTokenListing.StatusCode);

        using var writer = factory.CreateClient();
        writer.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", writeSecret);
        using var writeMutation = await writer.PostAsJsonAsync(
            new Uri($"/api/v1/tasks/{taskId}/comments", UriKind.Relative),
            new { body = "Commentaire déposé par un plugin, sans CSRF." },
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Created, writeMutation.StatusCode);

        var tokens = await ReadJsonAsync(await browser.GetAsync(
            new Uri("/api/v1/tokens", UriKind.Relative), TestContext.Current.CancellationToken));
        Assert.Equal(2, tokens.GetArrayLength());
        Assert.DoesNotContain(
            "secret",
            tokens.EnumerateArray().SelectMany(token => token.EnumerateObject()).Select(p => p.Name));
        var lastUsed = tokens.EnumerateArray()
            .Single(token => token.GetProperty("name").GetString() == "Robot Git")
            .GetProperty("lastUsedAt");
        Assert.NotEqual(JsonValueKind.Null, lastUsed.ValueKind);

        var readTokenId = readToken.GetProperty("token").GetProperty("id").GetGuid();
        using var revoke = await browser.DeleteAsync(
            new Uri($"/api/v1/tokens/{readTokenId}", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.NoContent, revoke.StatusCode);

        using var afterRevoke = await reader.GetAsync(
            new Uri("/api/v1/projects", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, afterRevoke.StatusCode);
    }

    [Fact]
    public async Task OpenApiDocumentDescribesTheApiWithoutAuthentication()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            new Uri("/api/v1/openapi.json", UriKind.Relative), TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var document = await ReadJsonAsync(response);
        Assert.Equal("3.1.0", document.GetProperty("openapi").GetString());
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/tasks/{taskId}", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/tasks/{taskId}/checklist", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects/{projectId}/labels", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/tasks/{taskId}/labels/{labelId}", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects/{projectId}/task-hierarchy", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects/{projectId}/task-page", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects/{projectId}/task-options", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/projects/{projectId}/media-previews", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/tasks/{taskId}/parent/{parentTaskId}", out _));
        Assert.True(document.GetProperty("paths").TryGetProperty("/api/v1/tokens", out _));
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
        using var projectsResponse = await client.GetAsync(
            new Uri("/api/v1/projects", UriKind.Relative), TestContext.Current.CancellationToken);
        var projects = await ReadJsonAsync(projectsResponse);
        var projectId = projects.EnumerateArray()
            .Single(project => project.GetProperty("key").GetString() == "MEDIA")
            .GetProperty("id")
            .GetGuid();
        using var previewsResponse = await client.GetAsync(
            new Uri($"/api/v1/projects/{projectId}/media-previews", UriKind.Relative),
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, previewsResponse.StatusCode);
        var previews = await ReadJsonAsync(previewsResponse);
        var preview = Assert.Single(previews.EnumerateArray());
        Assert.Equal(attachmentId, preview.GetProperty("id").GetGuid());
        Assert.Equal(taskId, preview.GetProperty("taskId").GetGuid());

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
    public async Task ReviewExtractsVideoDimensionsAndDurationForBothContainers()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);

        var mp4 = await UploadAttachmentAsync(
            client, taskId, "sequence.mp4", "video/mp4", Mp4WithMetadata(1920, 1080, 600, 4200));
        var webm = await UploadAttachmentAsync(
            client, taskId, "rush.webm", "video/webm", WebMWithMetadata(512, 768, 4.04));
        await factory.ReviewAttachmentsAsync();

        var reviewedMp4 = await FindAttachmentAsync(client, taskId, mp4.GetProperty("id").GetGuid());
        Assert.Equal("available", reviewedMp4.GetProperty("status").GetString());
        Assert.Equal("video/mp4", reviewedMp4.GetProperty("detectedContentType").GetString());
        Assert.Equal(1920, reviewedMp4.GetProperty("width").GetInt32());
        Assert.Equal(1080, reviewedMp4.GetProperty("height").GetInt32());
        Assert.Equal(7.0, reviewedMp4.GetProperty("durationSeconds").GetDouble(), 3);

        var reviewedWebm = await FindAttachmentAsync(client, taskId, webm.GetProperty("id").GetGuid());
        Assert.Equal("available", reviewedWebm.GetProperty("status").GetString());
        Assert.Equal("video/webm", reviewedWebm.GetProperty("detectedContentType").GetString());
        Assert.Equal(512, reviewedWebm.GetProperty("width").GetInt32());
        Assert.Equal(768, reviewedWebm.GetProperty("height").GetInt32());
        Assert.Equal(4.04, reviewedWebm.GetProperty("durationSeconds").GetDouble(), 3);
    }

    [Fact]
    public async Task VideoDownloadSupportsRangeRequestsForSeeking()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var taskId = await CreateTaskForAttachmentAsync(client);
        var bytes = Mp4WithMetadata(640, 360, 1000, 5000);

        var uploaded = await UploadAttachmentAsync(client, taskId, "clip.mp4", "video/mp4", bytes);
        await factory.ReviewAttachmentsAsync();

        using var request = new HttpRequestMessage(
            HttpMethod.Get, $"/api/v1/attachments/{uploaded.GetProperty("id").GetGuid()}/content");
        request.Headers.Range = new RangeHeaderValue(16, 47);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.PartialContent, response.StatusCode);
        Assert.Equal("video/mp4", response.Content.Headers.ContentType?.MediaType);
        Assert.Equal(
            bytes[16..48],
            await response.Content.ReadAsByteArrayAsync(TestContext.Current.CancellationToken));
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
        using var eventResponse = await OpenEventStreamAsync(client, null, timeout.Token);
        await using var stream = await eventResponse.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        _ = await ReadNamedSseEventAsync(reader, "ready", timeout.Token);

        _ = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Diffuser la création", description = "" });

        var created = await ReadNamedSseEventAsync(reader, "task.created", timeout.Token);
        Assert.True(Guid.TryParse(created.Id, out _));
    }

    [Fact]
    public async Task SseReconnectReplaysOnlyMissedEvents()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        var csrf = await BootstrapAsync(client);
        client.DefaultRequestHeaders.Add("X-CSRF-Token", csrf);
        var project = await PostAndReadAsync(
            client,
            "/api/v1/projects",
            new { name = "Reconnexion", key = "REC" });
        var projectId = project.GetProperty("id").GetGuid();

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        string firstEventId;
        using (var firstResponse = await OpenEventStreamAsync(client, null, timeout.Token))
        await using (var firstStream = await firstResponse.Content.ReadAsStreamAsync(timeout.Token))
        using (var firstReader = new StreamReader(firstStream))
        {
            _ = await ReadNamedSseEventAsync(firstReader, "ready", timeout.Token);
            _ = await PostAndReadAsync(
                client,
                $"/api/v1/projects/{projectId}/tasks",
                new { title = "Première tâche", description = "" });
            var firstEvent = await ReadNamedSseEventAsync(firstReader, "task.created", timeout.Token);
            firstEventId = Assert.IsType<string>(firstEvent.Id);
        }

        var missedTask = await PostAndReadAsync(
            client,
            $"/api/v1/projects/{projectId}/tasks",
            new { title = "Tâche manquée", description = "" });

        using var secondResponse = await OpenEventStreamAsync(client, firstEventId, timeout.Token);
        await using var secondStream = await secondResponse.Content.ReadAsStreamAsync(timeout.Token);
        using var secondReader = new StreamReader(secondStream);
        _ = await ReadNamedSseEventAsync(secondReader, "ready", timeout.Token);
        var replayed = await ReadNamedSseEventAsync(secondReader, "task.created", timeout.Token);

        Assert.NotEqual(firstEventId, replayed.Id);
        using var replayedData = JsonDocument.Parse(Assert.IsType<string>(replayed.Data));
        Assert.Equal(
            missedTask.GetProperty("id").GetGuid(),
            replayedData.RootElement.GetProperty("entityId").GetGuid());
    }

    [Fact]
    public async Task InvalidSseCursorRequestsClientResynchronization()
    {
        await using var factory = new CyTaskApiFactory();
        using var client = factory.CreateClient();
        await BootstrapAsync(client);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(TestContext.Current.CancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var response = await OpenEventStreamAsync(client, "not-a-guid", timeout.Token);
        await using var stream = await response.Content.ReadAsStreamAsync(timeout.Token);
        using var reader = new StreamReader(stream);
        _ = await ReadNamedSseEventAsync(reader, "ready", timeout.Token);
        var reset = await ReadNamedSseEventAsync(reader, "reset", timeout.Token);

        using var data = JsonDocument.Parse(Assert.IsType<string>(reset.Data));
        Assert.Equal("invalid_cursor", data.RootElement.GetProperty("reason").GetString());
    }

    [Fact]
    public async Task OutboxRetryDoesNotPublishTheSameEventTwice()
    {
        var options = Options.Create(new CyTaskOptions
        {
            UseInMemoryStore = false,
            OutboxBatchSize = 8
        });
        using var signal = new OutboxDispatchSignal();
        var hub = new WorkspaceEventHub(options, signal);
        var workspaceEvent = new WorkspaceEvent(
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            "task.created",
            Guid.CreateVersion7(),
            DateTimeOffset.UtcNow);
        var store = new RetryingOutboxStore(workspaceEvent);
        var dispatcher = new OutboxDispatcher(
            store,
            hub,
            signal,
            options,
            NullLogger<OutboxDispatcher>.Instance);
        using var subscription = hub.Subscribe(workspaceEvent.OrganizationId);

        Assert.Equal(1, await dispatcher.DispatchBatchAsync(TestContext.Current.CancellationToken));
        Assert.Equal(1, await dispatcher.DispatchBatchAsync(TestContext.Current.CancellationToken));

        Assert.True(subscription.Reader.TryRead(out var delivered));
        Assert.Equal(workspaceEvent.Id, delivered.Id);
        Assert.False(subscription.Reader.TryRead(out _));
        Assert.Equal(2, store.Claims);
        Assert.Equal(1, store.Failures);
        Assert.True(store.Processed);
    }

    private static async Task<HttpResponseMessage> OpenEventStreamAsync(
        HttpClient client,
        string? lastEventId,
        CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, "/api/v1/events");
        if (lastEventId is not null)
        {
            request.Headers.TryAddWithoutValidation("Last-Event-ID", lastEventId);
        }

        var response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return response;
    }

    private static async Task<SseEvent> ReadNamedSseEventAsync(
        StreamReader reader,
        string eventName,
        CancellationToken cancellationToken)
    {
        while (true)
        {
            var item = await ReadSseEventAsync(reader, cancellationToken);
            if (string.Equals(item.Event, eventName, StringComparison.Ordinal))
            {
                return item;
            }
        }
    }

    private static async Task<SseEvent> ReadSseEventAsync(
        StreamReader reader,
        CancellationToken cancellationToken)
    {
        string? id = null;
        string? eventName = null;
        string? data = null;
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (line.Length == 0)
            {
                if (id is not null || eventName is not null || data is not null)
                {
                    return new SseEvent(id, eventName, data);
                }

                continue;
            }

            if (line.StartsWith("id: ", StringComparison.Ordinal))
            {
                id = line[4..];
            }
            else if (line.StartsWith("event: ", StringComparison.Ordinal))
            {
                eventName = line[7..];
            }
            else if (line.StartsWith("data: ", StringComparison.Ordinal))
            {
                data = line[6..];
            }
        }

        throw new EndOfStreamException("The SSE stream ended before the expected event.");
    }

    private sealed record SseEvent(string? Id, string? Event, string? Data);

    private sealed class RetryingOutboxStore(WorkspaceEvent workspaceEvent) : IOutboxEventStore
    {
        private bool _failFirstAcknowledgement = true;

        public int Claims { get; private set; }

        public int Failures { get; private set; }

        public bool Processed { get; private set; }

        public Task<IReadOnlyList<OutboxDelivery>> ClaimBatchAsync(
            int limit,
            DateTimeOffset now,
            DateTimeOffset lockedUntil,
            CancellationToken cancellationToken)
        {
            Claims++;
            IReadOnlyList<OutboxDelivery> deliveries = Processed
                ? []
                : [new OutboxDelivery(workspaceEvent, Claims)];
            return Task.FromResult(deliveries);
        }

        public Task MarkProcessedAsync(
            Guid eventId,
            DateTimeOffset processedAt,
            CancellationToken cancellationToken)
        {
            if (_failFirstAcknowledgement)
            {
                _failFirstAcknowledgement = false;
                throw new InvalidOperationException("Transient acknowledgement failure.");
            }

            Processed = true;
            return Task.CompletedTask;
        }

        public Task MarkFailedAsync(
            Guid eventId,
            string failureMessage,
            DateTimeOffset availableAt,
            CancellationToken cancellationToken)
        {
            Failures++;
            return Task.CompletedTask;
        }

        public Task<int> DeleteProcessedBeforeAsync(
            DateTimeOffset cutoff,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<WorkspaceEventReplay> ReplayAfterAsync(
            Guid organizationId,
            Guid? afterEventId,
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult(new WorkspaceEventReplay(true, [], false));
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

    private static byte[] Mp4Box(string type, params byte[][] payload)
    {
        var body = payload.SelectMany(part => part).ToArray();
        return
        [
            .. BitConverter.GetBytes(System.Net.IPAddress.HostToNetworkOrder(body.Length + 8)),
            .. Encoding.ASCII.GetBytes(type),
            .. body
        ];
    }

    private static byte[] BigEndian(uint value) =>
        [(byte)(value >> 24), (byte)(value >> 16), (byte)(value >> 8), (byte)value];

    /// <summary>Conteneur MP4 minimal mais structurellement valide, sans données encodées.</summary>
    private static byte[] Mp4WithMetadata(uint width, uint height, uint timescale, uint duration)
    {
        var movieHeader = Mp4Box(
            "mvhd",
            [0, 0, 0, 0],
            BigEndian(0),
            BigEndian(0),
            BigEndian(timescale),
            BigEndian(duration),
            new byte[80]);
        var trackHeader = Mp4Box(
            "tkhd",
            [0, 0, 0, 0],
            BigEndian(0),
            BigEndian(0),
            BigEndian(1),
            BigEndian(0),
            BigEndian(0),
            new byte[16],
            new byte[36],
            BigEndian(width << 16),
            BigEndian(height << 16));
        return
        [
            .. Mp4Box("ftyp", Encoding.ASCII.GetBytes("isom"), BigEndian(512), Encoding.ASCII.GetBytes("isom")),
            .. Mp4Box("moov", movieHeader, Mp4Box("trak", trackHeader))
        ];
    }

    private static byte[] EbmlElement(byte[] id, params byte[][] payload)
    {
        var body = payload.SelectMany(part => part).ToArray();
        // Taille sur quatre octets : marqueur 0x10 puis vingt-huit bits de longueur.
        byte[] size =
        [
            (byte)(0x10 | ((body.Length >> 24) & 0x0F)),
            (byte)(body.Length >> 16),
            (byte)(body.Length >> 8),
            (byte)body.Length
        ];
        return [.. id, .. size, .. body];
    }

    private static byte[] EbmlUnsigned(byte[] id, uint value)
    {
        byte[] encoded = value <= 0xFF ? [(byte)value] : [.. BigEndian(value)];
        return [.. id, (byte)(0x80 | encoded.Length), .. encoded];
    }

    /// <summary>Segment WebM portant seulement Info et Tracks, sans cluster de données.</summary>
    private static byte[] WebMWithMetadata(uint width, uint height, double seconds)
    {
        var durationBytes = BitConverter.GetBytes(seconds * 1000.0);
        if (BitConverter.IsLittleEndian)
        {
            Array.Reverse(durationBytes);
        }

        var info = EbmlElement(
            [0x15, 0x49, 0xA9, 0x66],
            EbmlUnsigned([0x2A, 0xD7, 0xB1], 1_000_000),
            [0x44, 0x89, 0x88, .. durationBytes]);
        var video = EbmlElement(
            [0xE0],
            EbmlUnsigned([0xB0], width),
            EbmlUnsigned([0xBA], height));
        var tracks = EbmlElement([0x16, 0x54, 0xAE, 0x6B], EbmlElement([0xAE], video));
        return
        [
            .. EbmlElement([0x1A, 0x45, 0xDF, 0xA3], EbmlUnsigned([0x42, 0x86], 1)),
            .. EbmlElement([0x18, 0x53, 0x80, 0x67], info, tracks)
        ];
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
            builder.UseSetting("CyTask:UploadChunkBytes", "65536");
        }

        public Task<int> ReviewAttachmentsAsync() =>
            Services.GetRequiredService<AttachmentReviewService>()
                .ReviewBatchAsync(TestContext.Current.CancellationToken);

        protected override void Dispose(bool disposing)
        {
            base.Dispose(disposing);
            for (var attempt = 0; attempt < 5 && Directory.Exists(_mediaPath); attempt++)
            {
                try
                {
                    Directory.Delete(_mediaPath, recursive: true);
                }
                catch (IOException) when (attempt < 4)
                {
                    Thread.Sleep(25 * (attempt + 1));
                }
            }
        }
    }
}
