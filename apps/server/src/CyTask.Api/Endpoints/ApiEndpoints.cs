using System.Text.Json;
using System.Text;
using CyTask.Api.Configuration;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using Microsoft.Net.Http.Headers;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Endpoints;

public static class ApiEndpoints
{
    public static IEndpointRouteBuilder MapCyTaskApi(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapGet("/health/live", () => Results.Ok(new { status = "live" }));
        endpoints.MapGet("/health/ready", ReadyAsync);

        var api = endpoints.MapGroup("/api/v1");
        api.MapGet("/bootstrap/status", BootstrapStatusAsync);
        api.MapPost("/bootstrap", BootstrapAsync).RequireRateLimiting("authentication");
        api.MapPost("/sessions", LoginAsync).RequireRateLimiting("authentication");
        api.MapPost("/oauth/token", ExchangeNativeTokenAsync).RequireRateLimiting("authentication");
        api.MapPost("/invitations/preview", PreviewInvitationAsync).RequireRateLimiting("authentication");
        api.MapPost("/invitations/accept", AcceptInvitationAsync).RequireRateLimiting("authentication");

        api.MapGet("/openapi.json", GetOpenApiDocumentAsync);

        var authenticated = api.MapGroup(string.Empty)
            .AddEndpointFilter<RequireSessionFilter>()
            .AddEndpointFilter<ApiScopeFilter>();
        authenticated.MapGet("/me", GetMe);
        authenticated.MapDelete("/session", LogoutAsync).AddEndpointFilter<CsrfFilter>();
        authenticated.MapPost("/oauth/native/authorizations", CreateNativeAuthorizationAsync)
            .AddEndpointFilter<RequireCookieSessionFilter>()
            .AddEndpointFilter<CsrfFilter>();
        authenticated.MapDelete("/oauth/token", RevokeNativeTokenAsync)
            .AddEndpointFilter<RequireBearerTokenFilter>();
        authenticated.MapGet("/tokens", ListApiTokensAsync)
            .AddEndpointFilter<RequireCookieSessionFilter>();
        authenticated.MapPost("/tokens", CreateApiTokenAsync)
            .AddEndpointFilter<RequireCookieSessionFilter>()
            .AddEndpointFilter<CsrfFilter>();
        authenticated.MapDelete("/tokens/{tokenId:guid}", RevokeApiTokenAsync)
            .AddEndpointFilter<RequireCookieSessionFilter>()
            .AddEndpointFilter<CsrfFilter>();
        authenticated.MapGet("/events", EventsAsync);
        authenticated.MapGet("/activity", ListActivityAsync);
        authenticated.MapGet("/search", SearchAsync);
        authenticated.MapGet("/export", ExportAsync)
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapGet("/members", ListMembersAsync);
        authenticated.MapPost("/invitations", CreateInvitationAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapGet("/projects", ListProjectsAsync);
        authenticated.MapPost("/projects", CreateProjectAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapGet("/projects/{projectId:guid}/labels", GetProjectLabelsAsync);
        authenticated.MapPost("/projects/{projectId:guid}/labels", CreateProjectLabelAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapDelete(
                "/projects/{projectId:guid}/labels/{labelId:guid}",
                DeleteProjectLabelAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapPut(
                "/tasks/{taskId:guid}/labels/{labelId:guid}",
                AddTaskLabelAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapDelete(
                "/tasks/{taskId:guid}/labels/{labelId:guid}",
                RemoveTaskLabelAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet(
            "/projects/{projectId:guid}/task-hierarchy",
            GetProjectTaskHierarchyAsync);
        authenticated.MapPut(
                "/tasks/{taskId:guid}/parent/{parentTaskId:guid}",
                SetTaskParentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapDelete("/tasks/{taskId:guid}/parent", RemoveTaskParentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/projects/{projectId:guid}/task-page", GetTaskPageAsync);
        authenticated.MapGet("/projects/{projectId:guid}/task-options", ListTaskOptionsAsync);
        authenticated.MapGet("/projects/{projectId:guid}/tasks", ListTasksAsync);
        authenticated.MapPost("/projects/{projectId:guid}/tasks", CreateTaskAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/tasks/{taskId:guid}", GetTaskAsync);
        authenticated.MapPost("/tasks/{taskId:guid}/checklist", CreateChecklistItemAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPatch(
                "/tasks/{taskId:guid}/checklist/{itemId:guid}",
                UpdateChecklistItemAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapDelete(
                "/tasks/{taskId:guid}/checklist/{itemId:guid}",
                DeleteChecklistItemAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/tasks/{taskId:guid}/dependencies", GetTaskDependenciesAsync);
        authenticated.MapPost("/tasks/{taskId:guid}/dependencies", AddTaskDependencyAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapDelete(
                "/tasks/{taskId:guid}/dependencies/{dependsOnTaskId:guid}",
                RemoveTaskDependencyAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/tasks/{taskId:guid}/attachments", ListAttachmentsAsync);
        authenticated.MapGet("/attachments/{attachmentId:guid}/content", DownloadAttachmentAsync);
        authenticated.MapGet("/tasks/{taskId:guid}/external-references", ListExternalReferencesAsync);
        authenticated.MapPost("/tasks/{taskId:guid}/external-references", CreateExternalReferenceAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPost("/tasks/{taskId:guid}/attachment-uploads", CreateAttachmentUploadAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/attachment-uploads/{uploadId:guid}", GetAttachmentUploadAsync);
        authenticated.MapPut("/attachment-uploads/{uploadId:guid}/chunks/{index:int}", UploadAttachmentChunkAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPost("/attachment-uploads/{uploadId:guid}/complete", CompleteAttachmentUploadAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPatch("/tasks/{taskId:guid}", UpdateTaskAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPost("/tasks/{taskId:guid}/comments", AddCommentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));

        return endpoints;
    }

    private static async Task<IResult> ReadyAsync(IWorkspaceStore store, CancellationToken cancellationToken) =>
        await store.IsReadyAsync(cancellationToken)
            ? Results.Ok(new { status = "ready" })
            : Results.Problem(statusCode: StatusCodes.Status503ServiceUnavailable, title: "Storage unavailable");

    private static async Task<IResult> BootstrapStatusAsync(
        IWorkspaceStore store,
        CancellationToken cancellationToken) =>
        Results.Ok(new { required = !await store.HasUsersAsync(cancellationToken) });

    private static async Task<IResult> BootstrapAsync(
        BootstrapRequest request,
        HttpContext context,
        IWorkspaceStore store,
        PasswordService passwords,
        IHostEnvironment environment,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var errors = ValidateBootstrap(request);
        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var email = SessionSecurity.NormalizeEmail(request.Email);
        var displayName = request.DisplayName.Trim();
        var organizationName = request.OrganizationName.Trim();
        var slug = SessionSecurity.CreateSlug(organizationName);
        if (slug.Length is < 2 or > 80)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.OrganizationName)] = ["Le nom ne permet pas de créer un identifiant valide."]
            });
        }

        var sessionToken = SessionSecurity.CreateToken();
        var csrfToken = SessionSecurity.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddHours(options.Value.SessionHours);
        var result = await store.BootstrapAsync(
            email,
            displayName,
            passwords.Hash(request.Password),
            organizationName,
            slug,
            sessionToken,
            SessionSecurity.HashToken(sessionToken),
            csrfToken,
            SessionSecurity.HashToken(csrfToken),
            expiresAt,
            cancellationToken);

        if (result is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "CyTask is already initialized");
        }

        SessionSecurity.SetSessionCookies(
            context.Response, environment, result.SessionToken, result.CsrfToken, expiresAt);
        return Results.Ok(ToSessionResponse(result.User, result.CsrfToken));
    }

    private static async Task<IResult> LoginAsync(
        LoginRequest request,
        HttpContext context,
        IWorkspaceStore store,
        PasswordService passwords,
        IHostEnvironment environment,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        if (!SessionSecurity.IsValidEmail(request.Email) || request.Password.Length is < 1 or > 200)
        {
            return InvalidCredentials();
        }

        var user = await store.FindUserByEmailAsync(
            SessionSecurity.NormalizeEmail(request.Email), cancellationToken);
        if (!passwords.Verify(user?.PasswordHash, request.Password) || user is null)
        {
            return InvalidCredentials();
        }

        var sessionToken = SessionSecurity.CreateToken();
        var csrfToken = SessionSecurity.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddHours(options.Value.SessionHours);
        var result = await store.CreateSessionAsync(
            user.Id,
            sessionToken,
            SessionSecurity.HashToken(sessionToken),
            csrfToken,
            SessionSecurity.HashToken(csrfToken),
            expiresAt,
            cancellationToken);
        if (result is null)
        {
            return InvalidCredentials();
        }

        SessionSecurity.SetSessionCookies(
            context.Response, environment, result.SessionToken, result.CsrfToken, expiresAt);
        return Results.Ok(ToSessionResponse(result.User, result.CsrfToken));
    }

    private static async Task<IResult> CreateNativeAuthorizationAsync(
        CreateNativeAuthorizationRequest request,
        HttpContext context,
        IWorkspaceStore store,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        if (!NativeAuthorizationSecurity.IsValidClientId(request.ClientId) ||
            !NativeAuthorizationSecurity.IsValidRedirectUri(request.RedirectUri, out var redirectUri) ||
            !NativeAuthorizationSecurity.IsValidCodeChallenge(request.CodeChallenge) ||
            !string.Equals(
                request.CodeChallengeMethod, NativeAuthorizationSecurity.ChallengeMethod,
                StringComparison.Ordinal) ||
            !NativeAuthorizationSecurity.IsValidState(request.State))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["authorization"] = ["La demande d’autorisation native est invalide."]
            });
        }

        var user = context.GetUser()!;
        var code = SessionSecurity.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(options.Value.NativeAuthorizationCodeMinutes);
        var created = await store.CreateNativeAuthorizationAsync(
            user.UserId,
            user.OrganizationId,
            request.ClientId,
            request.RedirectUri,
            request.CodeChallenge,
            SessionSecurity.HashToken(code),
            expiresAt,
            cancellationToken);
        if (!created)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Native authorization could not be created");
        }

        var callback = new UriBuilder(redirectUri!)
        {
            Query = QueryString.Create(
            [
                new KeyValuePair<string, string?>("code", code),
                new KeyValuePair<string, string?>("state", request.State)
            ]).Value?.TrimStart('?') ?? string.Empty
        };
        SetNoStore(context.Response);
        return Results.Ok(new NativeAuthorizationResponse(callback.Uri.AbsoluteUri, expiresAt));
    }

    private static async Task<IResult> ExchangeNativeTokenAsync(
        HttpContext context,
        IWorkspaceStore store,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        SetNoStore(context.Response);
        if (!context.Request.HasFormContentType)
        {
            return OAuthError("invalid_request", "Form-encoded body required");
        }

        IFormCollection form;
        try
        {
            form = await context.Request.ReadFormAsync(cancellationToken);
        }
        catch (InvalidDataException)
        {
            return OAuthError("invalid_request", "Invalid form body");
        }

        var grantType = form["grant_type"].ToString();
        var clientId = form["client_id"].ToString();
        var code = form["code"].ToString();
        var redirectUri = form["redirect_uri"].ToString();
        var verifier = form["code_verifier"].ToString();
        if (!string.Equals(grantType, "authorization_code", StringComparison.Ordinal))
        {
            return OAuthError("unsupported_grant_type", "Only authorization_code is supported");
        }
        if (!NativeAuthorizationSecurity.IsValidClientId(clientId) ||
            !NativeAuthorizationSecurity.IsValidAuthorizationCode(code) ||
            !NativeAuthorizationSecurity.IsValidRedirectUri(redirectUri, out _) ||
            !NativeAuthorizationSecurity.IsValidCodeVerifier(verifier))
        {
            return OAuthError("invalid_grant", "The authorization grant is invalid");
        }

        var accessToken = NativeAuthorizationSecurity.CreateAccessToken();
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(options.Value.NativeAccessTokenMinutes);
        var user = await store.RedeemNativeAuthorizationAsync(
            SessionSecurity.HashToken(code),
            clientId,
            redirectUri,
            NativeAuthorizationSecurity.ComputeCodeChallenge(verifier),
            SessionSecurity.HashToken(accessToken),
            expiresAt,
            cancellationToken);
        if (user is null)
        {
            return OAuthError("invalid_grant", "The authorization grant is invalid");
        }

        return Results.Ok(new NativeTokenResponse(
            accessToken,
            "Bearer",
            checked(options.Value.NativeAccessTokenMinutes * 60),
            "workspace"));
    }

    private static async Task<IResult> RevokeNativeTokenAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        if (context.Items.TryGetValue(SessionSecurity.AccessTokenHashItem, out var value) &&
            value is byte[] accessTokenHash)
        {
            await store.DeleteAccessTokenAsync(accessTokenHash, cancellationToken);
        }
        return Results.NoContent();
    }

    private static async Task<IResult> PreviewInvitationAsync(
        InvitationTokenRequest request,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        if (!IsValidInvitationToken(request.Token))
        {
            return InvalidInvitation();
        }

        var invitation = await store.FindInvitationAsync(
            SessionSecurity.HashToken(request.Token), cancellationToken);
        return invitation is null ? InvalidInvitation() : Results.Ok(invitation);
    }

    private static async Task<IResult> AcceptInvitationAsync(
        AcceptInvitationRequest request,
        HttpContext context,
        IWorkspaceStore store,
        PasswordService passwords,
        WorkspaceEventHub events,
        IHostEnvironment environment,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var displayName = request.DisplayName.Trim();
        var errors = new Dictionary<string, string[]>();
        if (!IsValidInvitationToken(request.Token))
        {
            errors[nameof(request.Token)] = ["L’invitation est invalide ou expirée."];
        }

        if (displayName.Length is < 1 or > 80)
        {
            errors[nameof(request.DisplayName)] = ["Le nom doit contenir entre 1 et 80 caractères."];
        }

        if (request.Password.Length is < 12 or > 200)
        {
            errors[nameof(request.Password)] = ["Le mot de passe doit contenir entre 12 et 200 caractères."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var sessionToken = SessionSecurity.CreateToken();
        var csrfToken = SessionSecurity.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddHours(options.Value.SessionHours);
        var result = await store.AcceptInvitationAsync(
            SessionSecurity.HashToken(request.Token),
            displayName,
            passwords.Hash(request.Password),
            sessionToken,
            SessionSecurity.HashToken(sessionToken),
            csrfToken,
            SessionSecurity.HashToken(csrfToken),
            expiresAt,
            cancellationToken);
        if (result is null)
        {
            return InvalidInvitation();
        }

        SessionSecurity.SetSessionCookies(
            context.Response, environment, result.SessionToken, result.CsrfToken, expiresAt);
        events.Publish(result.User.OrganizationId, "invitation.accepted", result.User.UserId);
        return Results.Ok(ToSessionResponse(result.User, result.CsrfToken));
    }

    private static IResult GetMe(HttpContext context)
    {
        var user = context.GetUser()!;
        return Results.Ok(ToSessionResponse(user, string.Empty));
    }

    private static async Task<IResult> LogoutAsync(
        HttpContext context,
        IWorkspaceStore store,
        IHostEnvironment environment,
        CancellationToken cancellationToken)
    {
        if (context.Request.Cookies.TryGetValue(SessionSecurity.SessionCookie(environment), out var token))
        {
            await store.DeleteSessionAsync(SessionSecurity.HashToken(token), cancellationToken);
        }

        SessionSecurity.DeleteSessionCookies(context.Response, environment);
        return Results.NoContent();
    }

    private static async Task ListProjectsAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var projects = await store.ListProjectsAsync(user.OrganizationId, cancellationToken);
        await context.Response.WriteAsJsonAsync(projects, cancellationToken);
    }

    private static async Task<IResult> ListMembersAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        return Results.Ok(await store.ListMembersAsync(user.OrganizationId, cancellationToken));
    }

    private static async Task<IResult> ListActivityAsync(
        int? limit,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var safeLimit = Math.Clamp(limit ?? 50, 1, 100);
        return Results.Ok(await store.ListActivityAsync(
            user.OrganizationId, safeLimit, cancellationToken));
    }

    private static async Task<IResult> SearchAsync(
        string? q,
        int? limit,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var query = q?.Trim() ?? string.Empty;
        if (query.Length is < 2 or > 100)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["q"] = ["La recherche doit contenir entre 2 et 100 caractères."]
            });
        }

        var user = context.GetUser()!;
        var safeLimit = Math.Clamp(limit ?? 30, 1, 50);
        return Results.Ok(await store.SearchAsync(
            user.OrganizationId, query, safeLimit, cancellationToken));
    }

    private static async Task<IResult> ExportAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var export = await store.ExportAsync(user.OrganizationId, cancellationToken);
        if (export is null)
        {
            return Results.NotFound();
        }

        context.Response.Headers.CacheControl = "no-store";
        context.Response.Headers.ContentDisposition =
            $"attachment; filename=cytask-export-{DateTimeOffset.UtcNow:yyyyMMdd}.json";
        return Results.Json(export);
    }

    private static async Task<IResult> CreateInvitationAsync(
        CreateInvitationRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var email = SessionSecurity.NormalizeEmail(request.Email);
        var role = request.Role.Trim().ToLowerInvariant();
        var errors = new Dictionary<string, string[]>();
        if (!SessionSecurity.IsValidEmail(email))
        {
            errors[nameof(request.Email)] = ["L’adresse e-mail est invalide."];
        }

        if (role is not ("admin" or "member" or "viewer"))
        {
            errors[nameof(request.Role)] = ["Le rôle doit être admin, member ou viewer."];
        }

        var user = context.GetUser()!;
        if (user.Role == "admin" && role == "admin")
        {
            errors[nameof(request.Role)] = ["Seul le propriétaire peut inviter un administrateur."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var token = SessionSecurity.CreateToken();
        var expiresAt = DateTimeOffset.UtcNow.AddHours(options.Value.InvitationHours);
        var invitation = await store.CreateInvitationAsync(
            user.OrganizationId,
            user.UserId,
            email,
            role,
            token,
            SessionSecurity.HashToken(token),
            expiresAt,
            cancellationToken);
        if (invitation is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "This email is already registered or has a pending invitation");
        }

        events.Publish(user.OrganizationId, "invitation.created", invitation.Id);
        return Results.Created($"/api/v1/invitations/{invitation.Id}", invitation);
    }

    private static async Task<IResult> CreateProjectAsync(
        CreateProjectRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        var key = SessionSecurity.NormalizeProjectKey(request.Key);
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 120)
        {
            errors[nameof(request.Name)] = ["Le nom doit contenir entre 1 et 120 caractères."];
        }

        if (!SessionSecurity.IsValidProjectKey(key))
        {
            errors[nameof(request.Key)] = ["La clé doit contenir 2 à 10 lettres ou chiffres et commencer par une lettre."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var project = await store.CreateProjectAsync(
            user.OrganizationId, user.UserId, name, key, cancellationToken);
        if (project is null)
        {
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: "Project key already exists");
        }

        events.Publish(user.OrganizationId, "project.created", project.Id);
        return Results.Created($"/api/v1/projects/{project.Id}", project);
    }

    private static async Task<IResult> GetProjectLabelsAsync(
        Guid projectId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var overview = await store.GetProjectLabelsAsync(
            user.OrganizationId, projectId, cancellationToken);
        return overview is null ? Results.NotFound() : Results.Ok(overview);
    }

    private static async Task<IResult> CreateProjectLabelAsync(
        Guid projectId,
        CreateProjectLabelRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var name = request.Name?.Trim() ?? "";
        var color = request.Color?.Trim().ToUpperInvariant() ?? "";
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 80)
        {
            errors[nameof(request.Name)] = ["Le nom doit contenir entre 1 et 80 caractères."];
        }

        if (color.Length != 7 || color[0] != '#' || color[1..].Any(character => !Uri.IsHexDigit(character)))
        {
            errors[nameof(request.Color)] = ["La couleur doit être au format hexadécimal #RRGGBB."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var overview = await store.GetProjectLabelsAsync(
            user.OrganizationId, projectId, cancellationToken);
        if (overview is null)
        {
            return Results.NotFound();
        }

        if (overview.Labels.Count >= 64)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Un projet ne peut pas dépasser 64 labels.");
        }

        if (overview.Labels.Any(label =>
            string.Equals(label.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Un label portant ce nom existe déjà.");
        }

        var label = await store.CreateProjectLabelAsync(
            user.OrganizationId, projectId, user.UserId, name, color, cancellationToken);
        if (label is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Le label existe déjà ou la limite du projet est atteinte.");
        }

        events.Publish(user.OrganizationId, "project.label_created", projectId);
        return Results.Created($"/api/v1/projects/{projectId}/labels/{label.Id}", label);
    }

    private static async Task<IResult> DeleteProjectLabelAsync(
        Guid projectId,
        Guid labelId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var removed = await store.DeleteProjectLabelAsync(
            user.OrganizationId, projectId, labelId, user.UserId, cancellationToken);
        if (!removed)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "project.label_deleted", projectId);
        return Results.NoContent();
    }

    private static async Task<IResult> AddTaskLabelAsync(
        Guid taskId,
        Guid labelId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.AddTaskLabelAsync(
            user.OrganizationId, taskId, labelId, user.UserId, cancellationToken);
        if (result.Status == AddTaskLabelStatus.NotFound)
        {
            return Results.NotFound();
        }

        if (result.Status == AddTaskLabelStatus.Created)
        {
            events.Publish(user.OrganizationId, "task.label_added", taskId);
            return Results.Created(
                $"/api/v1/tasks/{taskId}/labels/{labelId}",
                result.Assignment);
        }

        return Results.Ok(result.Assignment);
    }

    private static async Task<IResult> RemoveTaskLabelAsync(
        Guid taskId,
        Guid labelId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var removed = await store.RemoveTaskLabelAsync(
            user.OrganizationId, taskId, labelId, user.UserId, cancellationToken);
        if (!removed)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "task.label_removed", taskId);
        return Results.NoContent();
    }

    private static async Task<IResult> GetProjectTaskHierarchyAsync(
        Guid projectId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var hierarchy = await store.GetProjectTaskHierarchyAsync(
            user.OrganizationId, projectId, cancellationToken);
        return hierarchy is null ? Results.NotFound() : Results.Ok(hierarchy);
    }

    private static async Task<IResult> SetTaskParentAsync(
        Guid taskId,
        Guid parentTaskId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.SetTaskParentAsync(
            user.OrganizationId, taskId, parentTaskId, user.UserId, cancellationToken);
        if (result.Status == SetTaskParentStatus.Updated)
        {
            events.Publish(user.OrganizationId, "task.parent_set", taskId);
            return Results.Ok(result.Relation);
        }

        return result.Status switch
        {
            SetTaskParentStatus.AlreadySet => Results.Ok(result.Relation),
            SetTaskParentStatus.NotFound => Results.NotFound(),
            SetTaskParentStatus.SelfParent => Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Une tâche ne peut pas être sa propre parente."),
            SetTaskParentStatus.Cycle => Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Cette hiérarchie créerait un cycle."),
            _ => Results.Problem(statusCode: StatusCodes.Status409Conflict)
        };
    }

    private static async Task<IResult> RemoveTaskParentAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var removed = await store.RemoveTaskParentAsync(
            user.OrganizationId, taskId, user.UserId, cancellationToken);
        if (!removed)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "task.parent_removed", taskId);
        return Results.NoContent();
    }

    private static async Task<IResult> GetTaskPageAsync(
        Guid projectId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var parameters = context.Request.Query;
        var query = parameters["query"].ToString().Trim();
        var rawStatus = parameters["status"].ToString().Trim().ToLowerInvariant();
        var rawPriority = parameters["priority"].ToString().Trim().ToLowerInvariant();
        var rawAssignee = parameters["assignee"].ToString().Trim().ToLowerInvariant();
        var due = parameters["due"].ToString().Trim().ToLowerInvariant();
        var rawLabel = parameters["label"].ToString().Trim().ToLowerInvariant();
        var sort = parameters["sort"].ToString().Trim().ToLowerInvariant();
        var rawCursor = parameters["cursor"].ToString().Trim();
        var rawLimit = parameters["limit"].ToString().Trim();
        var rawUtcOffset = parameters["utcOffsetMinutes"].ToString().Trim();

        string? status = rawStatus is "" or "all" ? null : rawStatus;
        string? priority = rawPriority is "" or "all" ? null : rawPriority;
        due = due.Length == 0 ? "all" : due;
        sort = sort.Length == 0 ? "updated" : sort;

        var errors = new Dictionary<string, string[]>();
        if (query.Length > 240)
        {
            errors["query"] = ["La recherche ne peut pas dépasser 240 caractères."];
        }

        if (status is not null
            && status is not ("todo" or "in_progress" or "blocked" or "done" or "cancelled"))
        {
            errors["status"] = ["Le statut est invalide."];
        }

        if (priority is not null && priority is not ("low" or "normal" or "high" or "urgent"))
        {
            errors["priority"] = ["La priorité est invalide."];
        }

        Guid? assigneeId = null;
        var unassigned = false;
        if (rawAssignee is not ("" or "all"))
        {
            if (rawAssignee == "unassigned")
            {
                unassigned = true;
            }
            else if (Guid.TryParse(rawAssignee, out var parsedAssigneeId))
            {
                assigneeId = parsedAssigneeId;
            }
            else
            {
                errors["assignee"] = ["La personne assignée est invalide."];
            }
        }

        if (due is not ("all" or "overdue" or "today" or "week" or "none"))
        {
            errors["due"] = ["Le filtre d’échéance est invalide."];
        }

        Guid? labelId = null;
        var withoutLabel = false;
        if (rawLabel is not ("" or "all"))
        {
            if (rawLabel == "none")
            {
                withoutLabel = true;
            }
            else if (Guid.TryParse(rawLabel, out var parsedLabelId))
            {
                labelId = parsedLabelId;
            }
            else
            {
                errors["label"] = ["Le label est invalide."];
            }
        }

        if (sort is not ("updated" or "created" or "due" or "key" or "title"))
        {
            errors["sort"] = ["Le tri est invalide."];
        }

        var limit = 50;
        if (rawLimit.Length > 0 && (!int.TryParse(rawLimit, out limit) || limit is < 1 or > 100))
        {
            errors["limit"] = ["La limite doit être comprise entre 1 et 100."];
        }

        var utcOffsetMinutes = 0;
        if (rawUtcOffset.Length > 0
            && (!int.TryParse(rawUtcOffset, out utcOffsetMinutes)
                || utcOffsetMinutes is < -840 or > 840))
        {
            errors["utcOffsetMinutes"] = ["Le décalage horaire est invalide."];
        }

        TaskPageCursor? cursor = null;
        if (rawCursor.Length > 0 && !TaskPageCursorCodec.TryDecode(rawCursor, sort, out cursor))
        {
            errors["cursor"] = ["Le curseur est invalide ou ne correspond plus au tri."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors, statusCode: StatusCodes.Status422UnprocessableEntity);
        }

        var now = DateTimeOffset.UtcNow;
        DateTimeOffset? dueStart = null;
        DateTimeOffset? dueEnd = null;
        if (due is "today" or "week")
        {
            var clientOffset = TimeSpan.FromMinutes(-utcOffsetMinutes);
            var clientNow = now.ToOffset(clientOffset);
            dueStart = new DateTimeOffset(
                clientNow.Year,
                clientNow.Month,
                clientNow.Day,
                0,
                0,
                0,
                clientOffset).ToUniversalTime();
            dueEnd = dueStart.Value.AddDays(due == "today" ? 1 : 8);
        }

        var user = context.GetUser()!;
        var page = await store.GetTaskPageAsync(
            user.OrganizationId,
            projectId,
            new TaskPageRequest(
                limit,
                query,
                status,
                priority,
                assigneeId,
                unassigned,
                due,
                now,
                dueStart,
                dueEnd,
                labelId,
                withoutLabel,
                sort,
                cursor),
            cancellationToken);
        if (page is null)
        {
            return Results.NotFound();
        }

        var nextCursor = page.HasMore && page.Items.Count > 0
            ? TaskPageCursorCodec.Encode(page.Items[^1], sort)
            : null;
        return Results.Ok(new TaskPageResponse(page.Items, page.TotalCount, nextCursor));
    }

    private static async Task<IResult> ListTaskOptionsAsync(
        Guid projectId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var tasks = await store.ListTaskOptionsAsync(
            user.OrganizationId,
            projectId,
            cancellationToken);
        return tasks is null ? Results.NotFound() : Results.Ok(tasks);
    }

    private static async Task<IResult> ListTasksAsync(
        Guid projectId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var tasks = await store.ListTasksAsync(user.OrganizationId, projectId, cancellationToken);
        return tasks is null ? Results.NotFound() : Results.Ok(tasks);
    }

    private static async Task<IResult> CreateTaskAsync(
        Guid projectId,
        CreateTaskRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var title = request.Title.Trim();
        var description = request.Description?.Trim() ?? string.Empty;
        var priority = (request.Priority ?? "normal").Trim().ToLowerInvariant();
        var dueAt = request.DueAt?.ToUniversalTime();
        var errors = new Dictionary<string, string[]>();
        if (title.Length is < 1 or > 240)
        {
            errors[nameof(request.Title)] = ["Le titre doit contenir entre 1 et 240 caractères."];
        }

        if (description.Length > 20_000)
        {
            errors[nameof(request.Description)] = ["La description ne peut pas dépasser 20 000 caractères."];
        }

        if (priority is not ("low" or "normal" or "high" or "urgent"))
        {
            errors[nameof(request.Priority)] = ["La priorité est invalide."];
        }

        if (request.AssigneeId is Guid assigneeId)
        {
            var members = await store.ListMembersAsync(user.OrganizationId, cancellationToken);
            if (members.All(member => member.UserId != assigneeId))
            {
                errors[nameof(request.AssigneeId)] = ["La personne assignée ne fait pas partie de l'organisation."];
            }
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var task = await store.CreateTaskAsync(
            user.OrganizationId,
            projectId,
            user.UserId,
            title,
            description,
            priority,
            dueAt,
            request.AssigneeId,
            cancellationToken);
        if (task is null)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "task.created", task.Id);
        return Results.Created($"/api/v1/tasks/{task.Id}", task);
    }

    private static async Task<IResult> GetTaskAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var task = await store.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        return task is null ? Results.NotFound() : Results.Ok(task);
    }


    private static async Task<IResult> CreateChecklistItemAsync(
        Guid taskId,
        CreateChecklistItemRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var title = request.Title.Trim();
        if (title.Length is < 1 or > 500)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.Title)] = ["Le titre doit contenir entre 1 et 500 caractères."]
            });
        }

        var user = context.GetUser()!;
        var current = await store.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (current is null)
        {
            return Results.NotFound();
        }

        if (current.Checklist.Count >= 200)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Une checklist ne peut pas dépasser 200 éléments.");
        }

        var item = await store.CreateChecklistItemAsync(
            user.OrganizationId, taskId, user.UserId, title, cancellationToken);
        if (item is null)
        {
            var taskStillExists = await store.GetTaskAsync(
                user.OrganizationId, taskId, cancellationToken) is not null;
            return taskStillExists
                ? Results.Problem(
                    statusCode: StatusCodes.Status409Conflict,
                    title: "La checklist a atteint sa limite.")
                : Results.NotFound();
        }

        events.Publish(user.OrganizationId, "task.checklist_item_created", taskId);
        return Results.Created($"/api/v1/tasks/{taskId}/checklist/{item.Id}", item);
    }

    private static async Task<IResult> UpdateChecklistItemAsync(
        Guid taskId,
        Guid itemId,
        UpdateChecklistItemRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var title = request.Title.Trim();
        var errors = new Dictionary<string, string[]>();
        if (title.Length is < 1 or > 500)
        {
            errors[nameof(request.Title)] = ["Le titre doit contenir entre 1 et 500 caractères."];
        }

        if (request.ExpectedRevision < 1)
        {
            errors[nameof(request.ExpectedRevision)] = ["La révision attendue doit être positive."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var result = await store.UpdateChecklistItemAsync(
            user.OrganizationId,
            taskId,
            itemId,
            user.UserId,
            title,
            request.IsCompleted,
            request.ExpectedRevision,
            cancellationToken);
        if (result.Status == UpdateChecklistItemStatus.NotFound)
        {
            return Results.NotFound();
        }

        if (result.Status == UpdateChecklistItemStatus.RevisionConflict)
        {
            return Results.Json(
                new { title = "La checklist a changé depuis son ouverture.", item = result.Item },
                statusCode: StatusCodes.Status409Conflict);
        }

        events.Publish(user.OrganizationId, "task.checklist_item_updated", taskId);
        return Results.Ok(result.Item);
    }

    private static async Task<IResult> DeleteChecklistItemAsync(
        Guid taskId,
        Guid itemId,
        long expectedRevision,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        if (expectedRevision < 1)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(expectedRevision)] = ["La révision attendue doit être positive."]
            });
        }

        var user = context.GetUser()!;
        var result = await store.DeleteChecklistItemAsync(
            user.OrganizationId,
            taskId,
            itemId,
            user.UserId,
            expectedRevision,
            cancellationToken);
        if (result == UpdateChecklistItemStatus.NotFound)
        {
            return Results.NotFound();
        }

        if (result == UpdateChecklistItemStatus.RevisionConflict)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "La checklist a changé depuis son ouverture.");
        }

        events.Publish(user.OrganizationId, "task.checklist_item_deleted", taskId);
        return Results.NoContent();
    }

    private static async Task<IResult> GetTaskDependenciesAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var dependencies = await store.GetTaskDependenciesAsync(
            user.OrganizationId, taskId, cancellationToken);
        return dependencies is null ? Results.NotFound() : Results.Ok(dependencies);
    }

    private static async Task<IResult> AddTaskDependencyAsync(
        Guid taskId,
        CreateTaskDependencyRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.AddTaskDependencyAsync(
            user.OrganizationId,
            taskId,
            request.DependsOnTaskId,
            user.UserId,
            cancellationToken);
        if (result.Status == AddTaskDependencyStatus.Created)
        {
            events.Publish(user.OrganizationId, "task.dependency_added", taskId);
            return Results.Created(
                $"/api/v1/tasks/{taskId}/dependencies/{request.DependsOnTaskId}",
                result.Dependency);
        }

        return result.Status switch
        {
            AddTaskDependencyStatus.AlreadyExists => Results.Ok(result.Dependency),
            AddTaskDependencyStatus.NotFound => Results.NotFound(),
            AddTaskDependencyStatus.SelfDependency => Results.Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Une tâche ne peut pas dépendre d’elle-même."),
            AddTaskDependencyStatus.Cycle => Results.Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Cette dépendance créerait un cycle."),
            _ => Results.Problem(statusCode: StatusCodes.Status500InternalServerError)
        };
    }

    private static async Task<IResult> RemoveTaskDependencyAsync(
        Guid taskId,
        Guid dependsOnTaskId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var removed = await store.RemoveTaskDependencyAsync(
            user.OrganizationId,
            taskId,
            dependsOnTaskId,
            user.UserId,
            cancellationToken);
        if (!removed)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "task.dependency_removed", taskId);
        return Results.NoContent();
    }

    private static async Task<IResult> ListAttachmentsAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var attachments = await store.ListAttachmentsAsync(
            user.OrganizationId, taskId, cancellationToken);
        return attachments is null ? Results.NotFound() : Results.Ok(attachments);
    }

    private static async Task<IResult> ListExternalReferencesAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var references = await store.ListExternalReferencesAsync(
            user.OrganizationId, taskId, cancellationToken);
        return references is null ? Results.NotFound() : Results.Ok(references);
    }

    private static async Task<IResult> CreateExternalReferenceAsync(
        Guid taskId,
        CreateExternalReferenceRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var provider = request.Provider.Trim().ToLowerInvariant();
        var repository = request.Repository.Trim();
        var referenceType = request.ReferenceType.Trim().ToLowerInvariant();
        var referenceValue = request.ReferenceValue.Trim();
        var label = request.Label.Trim();
        var webUrl = string.IsNullOrWhiteSpace(request.WebUrl) ? null : request.WebUrl.Trim();
        var errors = new Dictionary<string, string[]>();
        if (!SessionSecurity.IsValidProvider(provider))
        {
            errors[nameof(request.Provider)] = ["Le fournisseur doit être un identifiant comme git, github ou forgejo."];
        }

        if (repository.Length is < 1 or > 240 || repository.Any(char.IsControl))
        {
            errors[nameof(request.Repository)] = ["Le dépôt doit contenir entre 1 et 240 caractères."];
        }

        if (referenceType is not ("commit" or "branch" or "tag" or "merge_request"))
        {
            errors[nameof(request.ReferenceType)] = ["Le type de référence est invalide."];
        }

        if (referenceValue.Length is < 1 or > 240 || referenceValue.Any(char.IsControl))
        {
            errors[nameof(request.ReferenceValue)] = ["La valeur doit contenir entre 1 et 240 caractères."];
        }

        if (label.Length is < 1 or > 240 || label.Any(char.IsControl))
        {
            errors[nameof(request.Label)] = ["Le libellé doit contenir entre 1 et 240 caractères."];
        }

        if (webUrl is not null &&
            (webUrl.Length > 2048 || !Uri.TryCreate(webUrl, UriKind.Absolute, out var uri) ||
             uri.Scheme != Uri.UriSchemeHttps || !string.IsNullOrEmpty(uri.UserInfo)))
        {
            errors[nameof(request.WebUrl)] = ["Le lien doit être une URL HTTPS absolue sans identifiants intégrés."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var reference = await store.CreateExternalReferenceAsync(
            user.OrganizationId, taskId, user.UserId, provider, repository, referenceType,
            referenceValue, label, webUrl, cancellationToken);
        if (reference is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "This external reference already exists or the task is unavailable");
        }

        events.Publish(user.OrganizationId, "external_reference.created", reference.Id);
        return Results.Created($"/api/v1/tasks/{taskId}/external-references/{reference.Id}", reference);
    }

    private static async Task<IResult> ListApiTokensAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var tokens = await store.ListApiTokensAsync(user.OrganizationId, user.UserId, cancellationToken);
        return Results.Ok(tokens);
    }

    private static async Task<IResult> CreateApiTokenAsync(
        CreateApiTokenRequest request,
        HttpContext context,
        IWorkspaceStore store,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 80 || name.Any(char.IsControl))
        {
            errors[nameof(request.Name)] =
                ["Le nom doit contenir entre 1 et 80 caractères sans caractère de contrôle."];
        }

        var scopes = request.Scope switch
        {
            "read" => SessionSecurity.ReadScope,
            "write" => SessionSecurity.WriteScope,
            _ => null
        };
        if (scopes is null)
        {
            errors[nameof(request.Scope)] = ["La portée doit être « read » ou « write »."];
        }

        if (request.ExpiresInDays is < 1 or > 365)
        {
            errors[nameof(request.ExpiresInDays)] = ["L’expiration doit être comprise entre 1 et 365 jours."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var secret = SessionSecurity.CreateApiTokenSecret();
        var created = await store.CreateApiTokenAsync(
            user.OrganizationId,
            user.UserId,
            name,
            scopes!,
            secret,
            SessionSecurity.HashToken(secret),
            request.ExpiresInDays is null
                ? null
                : DateTimeOffset.UtcNow.AddDays(request.ExpiresInDays.Value),
            options.Value.MaxApiTokensPerUser,
            cancellationToken);
        if (created is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: $"Limite de {options.Value.MaxApiTokensPerUser} jetons actifs atteinte");
        }

        return Results.Created($"/api/v1/tokens/{created.Token.Id}", created);
    }

    private static async Task<IResult> RevokeApiTokenAsync(
        Guid tokenId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var revoked = await store.RevokeApiTokenAsync(
            user.OrganizationId, user.UserId, tokenId, cancellationToken);
        return revoked ? Results.NoContent() : Results.NotFound();
    }

    private static async Task<IResult> GetOpenApiDocumentAsync(
        HttpContext context,
        CancellationToken cancellationToken)
    {
        var assembly = typeof(ApiEndpoints).Assembly;
        await using var stream = assembly.GetManifestResourceStream("CyTask.Api.Contracts.openapi.json");
        if (stream is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status500InternalServerError,
                title: "The OpenAPI document is missing from this build");
        }

        context.Response.Headers.CacheControl = "public, max-age=3600";
        context.Response.ContentType = "application/json; charset=utf-8";
        await stream.CopyToAsync(context.Response.Body, cancellationToken);
        return Results.Empty;
    }

    private static async Task<IResult> DownloadAttachmentAsync(
        Guid attachmentId,
        HttpContext context,
        IWorkspaceStore store,
        LocalMediaStorage storage,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var attachment = await store.FindAttachmentAsync(
            user.OrganizationId, attachmentId, cancellationToken);
        if (attachment is null || attachment.Status != "available")
        {
            return Results.NotFound();
        }

        var content = storage.OpenObject(user.OrganizationId, attachmentId);
        if (content is null)
        {
            return Results.NotFound();
        }

        context.Response.Headers.CacheControl = "private, max-age=300, no-transform";
        return Results.File(
            content,
            ServableContentType(attachment.DetectedContentType),
            attachment.FileName,
            attachment.ReviewedAt ?? attachment.CreatedAt,
            new EntityTagHeaderValue($"\"{attachment.Sha256}\""),
            enableRangeProcessing: true);
    }

    private static string ServableContentType(string? detectedContentType) => detectedContentType switch
    {
        "image/png" or "image/jpeg" or "image/gif" or "image/webp" or
            "video/mp4" or "video/webm" => detectedContentType,
        _ => "application/octet-stream"
    };

    private static async Task<IResult> CreateAttachmentUploadAsync(
        Guid taskId,
        CreateAttachmentUploadRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var fileName = request.FileName.Trim().Normalize(NormalizationForm.FormC);
        var contentType = request.ContentType.Trim().ToLowerInvariant();
        var sha256 = request.Sha256.Trim().ToLowerInvariant();
        var errors = new Dictionary<string, string[]>();
        if (fileName.Length is < 1 or > 240 || fileName.Any(char.IsControl) ||
            fileName.Contains('/') || fileName.Contains('\\'))
        {
            errors[nameof(request.FileName)] =
                ["Le nom doit contenir entre 1 et 240 caractères, sans chemin ni caractère de contrôle."];
        }

        if (!SessionSecurity.IsValidContentType(contentType))
        {
            errors[nameof(request.ContentType)] = ["Le type de contenu déclaré est invalide."];
        }

        if (request.SizeBytes is < 1 || request.SizeBytes > options.Value.MaxAttachmentBytes)
        {
            errors[nameof(request.SizeBytes)] =
                [$"Le fichier doit contenir entre 1 octet et {options.Value.MaxAttachmentBytes} octets."];
        }

        if (!SessionSecurity.IsValidSha256(sha256))
        {
            errors[nameof(request.Sha256)] = ["L’empreinte SHA-256 est invalide."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        var upload = await store.CreateAttachmentUploadAsync(
            user.OrganizationId,
            taskId,
            user.UserId,
            Guid.CreateVersion7(),
            Guid.CreateVersion7(),
            fileName,
            contentType,
            request.SizeBytes,
            sha256,
            request.OptimizedLocally,
            options.Value.UploadChunkBytes,
            DateTimeOffset.UtcNow.AddHours(options.Value.UploadHours),
            cancellationToken);
        if (upload is null)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "attachment.upload_started", upload.Attachment.Id);
        return Results.Created($"/api/v1/attachment-uploads/{upload.Id}", upload);
    }

    private static async Task<IResult> GetAttachmentUploadAsync(
        Guid uploadId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var upload = await store.GetAttachmentUploadAsync(
            user.OrganizationId, uploadId, cancellationToken);
        return upload is null ? Results.NotFound() : Results.Ok(upload);
    }

    private static async Task<IResult> UploadAttachmentChunkAsync(
        Guid uploadId,
        int index,
        HttpContext context,
        IWorkspaceStore store,
        LocalMediaStorage storage,
        CancellationToken cancellationToken)
    {
        var request = context.Request;
        var user = context.GetUser()!;
        var declaredSha256 = request.Headers["X-Chunk-SHA256"].ToString().Trim().ToLowerInvariant();
        if (index < 0 || !SessionSecurity.IsValidSha256(declaredSha256))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                ["chunk"] = ["L’index ou l’empreinte SHA-256 du bloc est invalide."]
            });
        }

        if (!string.Equals(request.ContentType, "application/octet-stream", StringComparison.OrdinalIgnoreCase))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status415UnsupportedMediaType,
                title: "Chunks must use application/octet-stream");
        }

        var upload = await store.GetAttachmentUploadAsync(user.OrganizationId, uploadId, cancellationToken);
        if (upload is null)
        {
            return Results.NotFound();
        }

        var existing = upload.Chunks.SingleOrDefault(chunk => chunk.Index == index);
        if (existing is not null)
        {
            return existing.Sha256 == declaredSha256 && existing.SizeBytes == request.ContentLength
                ? Results.Ok(existing)
                : Results.Conflict();
        }

        var received = upload.Chunks.Sum(chunk => chunk.SizeBytes);
        var expectedSize = Math.Min(upload.ChunkSizeBytes, upload.Attachment.SizeBytes - received);
        if (index != upload.Chunks.Count || request.ContentLength is null ||
            request.ContentLength != expectedSize || expectedSize <= 0)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Unexpected chunk index or size");
        }

        StoredChunk stored;
        try
        {
            stored = await storage.WriteChunkAsync(
                user.OrganizationId, uploadId, index, request.Body, expectedSize, cancellationToken);
        }
        catch (MediaStorageLimitException exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status413PayloadTooLarge, title: exception.Message);
        }
        catch (MediaStorageConflictException exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: exception.Message);
        }

        if (stored.SizeBytes != expectedSize || stored.Sha256 != declaredSha256)
        {
            storage.DeleteChunk(user.OrganizationId, uploadId, index);
            return Results.Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Chunk fingerprint mismatch");
        }

        var result = await store.RecordAttachmentChunkAsync(
            user.OrganizationId, uploadId, index, stored.SizeBytes, stored.Sha256, cancellationToken);
        if (result.Status is RecordChunkStatus.Conflict or RecordChunkStatus.NotFound)
        {
            storage.DeleteChunk(user.OrganizationId, uploadId, index);
            return result.Status == RecordChunkStatus.NotFound ? Results.NotFound() : Results.Conflict();
        }

        return Results.Ok(result.Chunk);
    }

    private static async Task<IResult> CompleteAttachmentUploadAsync(
        Guid uploadId,
        HttpContext context,
        IWorkspaceStore store,
        LocalMediaStorage storage,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var upload = await store.GetAttachmentUploadAsync(
            user.OrganizationId, uploadId, cancellationToken);
        if (upload is null)
        {
            return Results.NotFound();
        }

        if (upload.Chunks.Sum(chunk => chunk.SizeBytes) != upload.Attachment.SizeBytes)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The upload is incomplete");
        }

        AssembledBlob assembled;
        try
        {
            assembled = await storage.AssembleInQuarantineAsync(
                user.OrganizationId, upload, cancellationToken);
        }
        catch (MediaStorageConflictException exception)
        {
            return Results.Problem(statusCode: StatusCodes.Status409Conflict, title: exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or FileNotFoundException or DirectoryNotFoundException)
        {
            await store.RejectAttachmentUploadAsync(user.OrganizationId, uploadId, cancellationToken);
            storage.DeleteUpload(user.OrganizationId, uploadId);
            events.Publish(user.OrganizationId, "attachment.rejected", upload.Attachment.Id);
            return Results.Problem(
                statusCode: StatusCodes.Status422UnprocessableEntity,
                title: "Attachment fingerprint or stored chunks are invalid");
        }

        var attachment = await store.CompleteAttachmentUploadAsync(
            user.OrganizationId, uploadId, assembled.DetectedContentType, cancellationToken);
        if (attachment is null)
        {
            storage.DeleteQuarantined(user.OrganizationId, upload.Attachment.Id);
            return Results.Conflict();
        }

        events.Publish(user.OrganizationId, "attachment.quarantined", attachment.Id);
        return Results.Ok(attachment);
    }

    private static async Task<IResult> UpdateTaskAsync(
        Guid taskId,
        UpdateTaskRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var title = request.Title.Trim();
        var description = request.Description?.Trim() ?? string.Empty;
        var status = request.Status.Trim().ToLowerInvariant();
        var requestedPriority = request.Priority?.Trim().ToLowerInvariant();
        var errors = new Dictionary<string, string[]>();
        if (title.Length is < 1 or > 240)
        {
            errors[nameof(request.Title)] = ["Le titre doit contenir entre 1 et 240 caractères."];
        }

        if (description.Length > 20_000)
        {
            errors[nameof(request.Description)] = ["La description ne peut pas dépasser 20 000 caractères."];
        }

        if (status is not ("todo" or "in_progress" or "blocked" or "done" or "cancelled"))
        {
            errors[nameof(request.Status)] = ["Le statut est invalide."];
        }

        if (request.PrioritySpecified
            && requestedPriority is not ("low" or "normal" or "high" or "urgent"))
        {
            errors[nameof(request.Priority)] = ["La priorité est invalide."];
        }

        if (request.ExpectedRevision < 1)
        {
            errors[nameof(request.ExpectedRevision)] = ["La révision attendue doit être positive."];
        }

        if (errors.Count > 0)
        {
            return Results.ValidationProblem(errors);
        }

        var user = context.GetUser()!;
        if (request.AssigneeIdSpecified && request.AssigneeId is Guid requestedAssigneeId)
        {
            var members = await store.ListMembersAsync(user.OrganizationId, cancellationToken);
            if (members.All(member => member.UserId != requestedAssigneeId))
            {
                return Results.ValidationProblem(new Dictionary<string, string[]>
                {
                    [nameof(request.AssigneeId)] = ["La personne assignée ne fait pas partie de l'organisation."]
                });
            }
        }

        var current = await store.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (current is null)
        {
            return Results.NotFound();
        }

        var priority = request.PrioritySpecified ? requestedPriority! : current.Task.Priority;
        var dueAt = request.DueAtSpecified
            ? request.DueAt?.ToUniversalTime()
            : current.Task.DueAt;
        var assigneeId = request.AssigneeIdSpecified
            ? request.AssigneeId
            : current.Task.AssigneeId;
        var result = await store.UpdateTaskAsync(
            user.OrganizationId,
            taskId,
            user.UserId,
            title,
            description,
            status,
            priority,
            dueAt,
            assigneeId,
            request.ExpectedRevision,
            cancellationToken);
        if (result.Status == UpdateTaskStatus.NotFound)
        {
            return Results.NotFound();
        }

        if (result.Status == UpdateTaskStatus.RevisionConflict)
        {
            return Results.Json(
                new { title = "Task changed since it was opened", task = result.Task },
                statusCode: StatusCodes.Status409Conflict);
        }

        events.Publish(user.OrganizationId, "task.updated", taskId);
        return Results.Ok(result.Task);
    }

    private static async Task<IResult> AddCommentAsync(
        Guid taskId,
        CreateCommentRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var body = request.Body.Trim();
        if (body.Length is < 1 or > 10_000)
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.Body)] = ["Le commentaire doit contenir entre 1 et 10 000 caractères."]
            });
        }

        var user = context.GetUser()!;
        var comment = await store.AddCommentAsync(
            user.OrganizationId, taskId, user.UserId, body, cancellationToken);
        if (comment is null)
        {
            return Results.NotFound();
        }

        events.Publish(user.OrganizationId, "comment.created", taskId);
        return Results.Created($"/api/v1/tasks/{taskId}#comment-{comment.Id}", comment);
    }

    private static async Task EventsAsync(
        HttpContext context,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        context.Response.StatusCode = StatusCodes.Status200OK;
        context.Response.ContentType = "text/event-stream";
        context.Response.Headers.CacheControl = "no-cache, no-store";
        context.Response.Headers.Append("X-Accel-Buffering", "no");

        using var subscription = events.Subscribe(user.OrganizationId);
        await context.Response.WriteAsync("event: ready\ndata: {}\n\n", cancellationToken);
        await context.Response.Body.FlushAsync(cancellationToken);

        await foreach (var workspaceEvent in subscription.Reader.ReadAllAsync(cancellationToken))
        {
            var data = JsonSerializer.Serialize(workspaceEvent);
            await context.Response.WriteAsync(
                $"id: {workspaceEvent.Id}\nevent: {workspaceEvent.Type}\ndata: {data}\n\n",
                cancellationToken);
            await context.Response.Body.FlushAsync(cancellationToken);
        }
    }

    private static Dictionary<string, string[]> ValidateBootstrap(BootstrapRequest request)
    {
        var errors = new Dictionary<string, string[]>();
        if (!SessionSecurity.IsValidEmail(request.Email))
        {
            errors[nameof(request.Email)] = ["L’adresse e-mail est invalide."];
        }

        if (request.DisplayName.Trim().Length is < 1 or > 80)
        {
            errors[nameof(request.DisplayName)] = ["Le nom doit contenir entre 1 et 80 caractères."];
        }

        if (request.Password.Length is < 12 or > 200)
        {
            errors[nameof(request.Password)] = ["Le mot de passe doit contenir entre 12 et 200 caractères."];
        }

        if (request.OrganizationName.Trim().Length is < 2 or > 120)
        {
            errors[nameof(request.OrganizationName)] = ["L’organisation doit contenir entre 2 et 120 caractères."];
        }

        return errors;
    }

    private static SessionResponse ToSessionResponse(AuthenticatedUser user, string csrfToken) => new(
        user.UserId, user.OrganizationId, user.Email, user.DisplayName, user.Role, csrfToken);

    private static IResult InvalidCredentials() => Results.Problem(
        statusCode: StatusCodes.Status401Unauthorized,
        title: "Invalid email or password");

    private static IResult OAuthError(string error, string description) => Results.Json(
        new Dictionary<string, string>
        {
            ["error"] = error,
            ["error_description"] = description
        },
        statusCode: StatusCodes.Status400BadRequest);

    private static void SetNoStore(HttpResponse response)
    {
        response.Headers.CacheControl = "no-store";
        response.Headers.Pragma = "no-cache";
    }

    private static bool IsValidInvitationToken(string token) =>
        token.Length is >= 40 and <= 128 && token.All(character =>
            char.IsAsciiLetterOrDigit(character) || character is '-' or '_');

    private static IResult InvalidInvitation() => Results.Problem(
        statusCode: StatusCodes.Status404NotFound,
        title: "Invitation invalid or expired");
}
