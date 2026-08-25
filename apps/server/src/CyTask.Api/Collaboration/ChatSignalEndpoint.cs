using CyTask.Api.Security;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task SignalAsync(
        Guid channelId, HttpContext context, ICollaborationStore store,
        ChatSignalHub signals, CancellationToken cancellationToken)
    {
        if (!context.WebSockets.IsWebSocketRequest)
        {
            context.Response.StatusCode = StatusCodes.Status400BadRequest;
            return;
        }
        var expectedOrigin = $"{context.Request.Scheme}://{context.Request.Host}";
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
        await signals.RunAsync(channelId, user.UserId, socket, cancellationToken);
    }
}
