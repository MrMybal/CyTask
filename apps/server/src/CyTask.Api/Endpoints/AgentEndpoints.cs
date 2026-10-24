using System.Text.RegularExpressions;
using CyTask.Api.Configuration;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Security;
using CyTask.Api.Realtime;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Endpoints;

public static partial class AgentEndpoints
{
    public static RouteGroupBuilder MapAgentEndpoints(this RouteGroupBuilder endpoints)
    {
        endpoints.MapGet("/agents", ListAgentsAsync);
        endpoints.MapPost("/agents", CreateAgentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        endpoints.MapPatch("/agents/{agentUserId:guid}/status", UpdateAgentStatusAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        endpoints.MapPost("/agents/{agentUserId:guid}/notifications", CallAgentAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));

        endpoints.MapGet("/agent/context", GetAgentContextAsync)
            .AddEndpointFilter<RequireBearerTokenFilter>();
        endpoints.MapGet("/agent/notifications", ListNotificationsAsync)
            .AddEndpointFilter<RequireBearerTokenFilter>();
        endpoints.MapPost("/agent/notifications/{notificationId:guid}/ack", AcknowledgeAsync)
            .AddEndpointFilter<RequireBearerTokenFilter>();
        endpoints.MapPost("/agent/tasks/{taskId:guid}/claim", ClaimTaskAsync)
            .AddEndpointFilter<RequireBearerTokenFilter>();
        return endpoints;
    }

    private static async Task<IResult> ListAgentsAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        return Results.Ok(await store.ListAgentsAsync(user.OrganizationId, cancellationToken));
    }

    private static async Task<IResult> CreateAgentAsync(
        CreateAgentRequest request,
        HttpContext context,
        IWorkspaceStore store,
        PasswordService passwords,
        IOptions<CyTaskOptions> options,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var key = request.Key?.Trim().ToLowerInvariant() ?? string.Empty;
        var displayName = request.DisplayName?.Trim() ?? string.Empty;
        var description = request.Description?.Trim() ?? string.Empty;
        var capabilities = (request.Capabilities ?? [])
            .Select(item => item?.Trim().ToLowerInvariant() ?? string.Empty)
            .Where(item => item.Length > 0)
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        var errors = ValidateAgent(key, displayName, description, capabilities);
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var user = context.GetUser()!;
        var token = SessionSecurity.CreateApiTokenSecret();
        var created = await store.CreateAgentAsync(
            user.OrganizationId,
            user.UserId,
            key,
            displayName,
            description,
            capabilities,
            passwords.Hash(SessionSecurity.CreateToken(48)),
            token,
            SessionSecurity.HashToken(token),
            options.Value.MaxApiTokensPerUser,
            cancellationToken);
        if (created is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Agent key already exists or cannot be created");
        }
        events.Publish(user.OrganizationId, "agent.created", created.Agent.UserId);
        return Results.Created($"/api/v1/agents/{created.Agent.UserId}", created);
    }

    private static async Task<IResult> UpdateAgentStatusAsync(
        Guid agentUserId,
        UpdateAgentStatusRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var status = request.Status?.Trim().ToLowerInvariant() ?? string.Empty;
        if (status is not ("active" or "paused" or "disabled"))
        {
            return Results.ValidationProblem(new Dictionary<string, string[]>
            {
                [nameof(request.Status)] = ["Status must be active, paused or disabled."]
            });
        }
        var user = context.GetUser()!;
        var updated = await store.UpdateAgentStatusAsync(
            user.OrganizationId, agentUserId, user.UserId, status, cancellationToken);
        if (updated is null) return Results.NotFound();
        events.Publish(user.OrganizationId, "agent.status_updated", agentUserId);
        return Results.Ok(updated);
    }

    private static async Task<IResult> CallAgentAsync(
        Guid agentUserId,
        CreateAgentCallRequest request,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var type = (request.Type ?? "work.requested").Trim().ToLowerInvariant();
        var title = request.Title?.Trim() ?? string.Empty;
        var body = request.Body?.Trim() ?? string.Empty;
        var errors = new Dictionary<string, string[]>();
        if (!NotificationTypeRegex().IsMatch(type))
            errors[nameof(request.Type)] = ["Notification type is invalid."];
        if (title.Length is < 1 or > 160)
            errors[nameof(request.Title)] = ["Title must contain between 1 and 160 characters."];
        if (body.Length > 10_000)
            errors[nameof(request.Body)] = ["Body must not exceed 10000 characters."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var user = context.GetUser()!;
        var notification = await store.CreateAgentNotificationAsync(
            user.OrganizationId, agentUserId, user.UserId, type, title, body,
            request.TaskId, cancellationToken);
        if (notification is not null) events.Publish(user.OrganizationId, "agent.called", agentUserId);
        return notification is null ? Results.NotFound() : Results.Created(
            $"/api/v1/agent/notifications/{notification.Id}", notification);
    }

    private static async Task<IResult> GetAgentContextAsync(
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.GetAgentContextAsync(
            user.OrganizationId, user.UserId, cancellationToken);
        return result is null
            ? Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Agent access required")
            : Results.Ok(result);
    }

    private static async Task<IResult> ListNotificationsAsync(
        bool includeAcknowledged,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        if (await store.FindAgentAsync(user.OrganizationId, user.UserId, cancellationToken) is null)
            return Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Agent access required");
        return Results.Ok(await store.ListAgentNotificationsAsync(
            user.OrganizationId, user.UserId, includeAcknowledged, cancellationToken));
    }

    private static async Task<IResult> AcknowledgeAsync(
        Guid notificationId,
        HttpContext context,
        IWorkspaceStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.AcknowledgeAgentNotificationAsync(
            user.OrganizationId, user.UserId, notificationId, cancellationToken);
        return result is null ? Results.NotFound() : Results.Ok(result);
    }

    private static async Task<IResult> ClaimTaskAsync(
        Guid taskId,
        HttpContext context,
        IWorkspaceStore store,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var result = await store.ClaimTaskForAgentAsync(
            user.OrganizationId, user.UserId, taskId, cancellationToken);
        if (result.Status == ClaimAgentTaskStatus.Claimed)
            events.Publish(user.OrganizationId, "task.claimed", taskId);
        return result.Status switch
        {
            ClaimAgentTaskStatus.Claimed => Results.Ok(result),
            ClaimAgentTaskStatus.AlreadyClaimed => Results.Ok(result),
            ClaimAgentTaskStatus.NotFound => Results.NotFound(),
            ClaimAgentTaskStatus.AssignedToAnotherMember => Results.Conflict(result),
            _ => Results.Problem(statusCode: StatusCodes.Status403Forbidden, title: "Agent is not active")
        };
    }

    private static Dictionary<string, string[]> ValidateAgent(
        string key,
        string displayName,
        string description,
        string[] capabilities)
    {
        var errors = new Dictionary<string, string[]>();
        if (!AgentKeyRegex().IsMatch(key))
            errors[nameof(CreateAgentRequest.Key)] = ["Key must use 2-40 lowercase letters, digits or hyphens."];
        if (displayName.Length is < 1 or > 80)
            errors[nameof(CreateAgentRequest.DisplayName)] = ["Display name must contain between 1 and 80 characters."];
        if (description.Length > 2_000)
            errors[nameof(CreateAgentRequest.Description)] = ["Description must not exceed 2000 characters."];
        if (capabilities.Length > 32 || capabilities.Any(item => !CapabilityRegex().IsMatch(item)))
            errors[nameof(CreateAgentRequest.Capabilities)] = ["Capabilities must contain up to 32 safe identifiers."];
        return errors;
    }

    [GeneratedRegex("^[a-z][a-z0-9-]{1,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex AgentKeyRegex();

    [GeneratedRegex("^[a-z][a-z0-9:._-]{0,63}$", RegexOptions.CultureInvariant)]
    private static partial Regex CapabilityRegex();

    [GeneratedRegex("^[a-z][a-z0-9_.-]{0,39}$", RegexOptions.CultureInvariant)]
    private static partial Regex NotificationTypeRegex();
}
