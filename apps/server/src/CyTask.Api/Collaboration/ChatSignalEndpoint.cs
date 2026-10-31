using CyTask.Api.Security;
using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Spaces;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task<IResult> CallConfigurationAsync(Guid channelId, HttpContext context,
        ICollaborationStore store, IOptions<CyTaskOptions> options, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        if (await store.GetChannelAsync(user.OrganizationId, channelId, user.UserId, cancellationToken) is null)
            return Results.NotFound();
        context.Response.Headers.CacheControl = "no-store";
        return Results.Ok(CallConfiguration.Create(options.Value, user.OrganizationId, user.UserId, channelId, DateTimeOffset.UtcNow));
    }

    private static async Task SignalAsync(
        Guid channelId, HttpContext context, ICollaborationStore store,
        ChatSignalHub signals, IWorkspaceStore workspace, ProjectAccessService access,
        IOptions<CyTaskOptions> options, IHostEnvironment environment, MfaService mfa, CancellationToken cancellationToken)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        // Explicit public origin supports TLS termination without trusting
        // client-supplied forwarded headers or relaxing the origin comparison.
        var expectedOrigin = string.IsNullOrEmpty(options.Value.WebRtcPublicOrigin)
            ? $"{context.Request.Scheme}://{context.Request.Host}"
            : new Uri(options.Value.WebRtcPublicOrigin).GetLeftPart(UriPartial.Authority);
        var origin = context.Request.Headers.Origin.ToString();
        if (!string.Equals(origin, expectedOrigin, StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
        var user = context.GetUser()!;
        if (await store.GetChannelAsync(
                user.OrganizationId, channelId, user.UserId, cancellationToken) is null)
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        var socket = await context.WebSockets.AcceptWebSocketAsync();
        var cookie = context.Request.Cookies[SessionSecurity.SessionCookie(environment, options.Value.LocalMode)]!;
        var sessionHash = SessionSecurity.HashToken(cookie);
        using var lifetime = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var watch = WatchAccessAsync();
        try { await signals.RunAsync(channelId, user.UserId, socket, lifetime.Token); }
        finally { await lifetime.CancelAsync(); await watch; }

        async Task WatchAccessAsync()
        {
            try
            {
                using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.Value.CallAccessCheckSeconds));
                while (await timer.WaitForNextTickAsync(lifetime.Token))
                {
                    var current = await workspace.FindSessionAsync(sessionHash, lifetime.Token);
                    var channel = current is null ? null : await store.GetChannelAsync(current.OrganizationId, channelId, current.UserId, lifetime.Token);
                    var role = channel is null || current is null ? null : await access.RoleAsync(current, channel.ProjectId, lifetime.Token);
                    if (role is "owner" or "admin" or "member" && current is not null
                        && await mfa.CredentialAllowedAsync(current.UserId,sessionHash,lifetime.Token)) continue;
                    await RevokeAsync(); break;
                }
            }
            catch (OperationCanceledException) when (lifetime.IsCancellationRequested) { }
            catch (Exception exception) when (exception is not OutOfMemoryException)
            {
                // Fail closed if access cannot be revalidated; never log session material.
                await RevokeAsync();
            }
        }
        async Task RevokeAsync()
        {
            try { socket.Abort(); }
            catch (ObjectDisposedException) { }
            finally { await lifetime.CancelAsync(); }
        }
    }
}
