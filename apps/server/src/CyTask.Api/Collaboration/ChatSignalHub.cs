using System.Collections.Concurrent;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;

namespace CyTask.Api.Collaboration;

public sealed class ChatSignalHub
{
    private readonly ConcurrentDictionary<Guid, ConcurrentDictionary<Guid, Client>> _rooms = [];

    public async Task RunAsync(
        Guid channelId, Guid userId, WebSocket socket, CancellationToken cancellationToken)
    {
        var connectionId = Guid.CreateVersion7();
        var client = new Client(userId, socket);
        var room = _rooms.GetOrAdd(channelId, _ => new());
        room[connectionId] = client;
        await SendAsync(client, new
        {
            type = "presence",
            users = room.Values.Select(item => item.UserId).Distinct().Where(id => id != userId)
        }, cancellationToken);
        await BroadcastAsync(room, connectionId, new { type = "peer.joined", userId }, cancellationToken);

        var buffer = new byte[64 * 1024];
        var windowStarted = DateTimeOffset.UtcNow;
        var messagesInWindow = 0;
        try
        {
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var result = await socket.ReceiveAsync(buffer, cancellationToken);
                if (result.MessageType == WebSocketMessageType.Close) break;
                if (result.MessageType != WebSocketMessageType.Text || !result.EndOfMessage)
                {
                    await socket.CloseAsync(
                        WebSocketCloseStatus.MessageTooBig, "Message de signalisation trop grand.",
                        cancellationToken);
                    break;
                }

                var now = DateTimeOffset.UtcNow;
                if (now - windowStarted > TimeSpan.FromSeconds(10))
                {
                    windowStarted = now;
                    messagesInWindow = 0;
                }
                if (++messagesInWindow > 80)
                {
                    await socket.CloseAsync(
                        WebSocketCloseStatus.PolicyViolation, "Trop de messages.", cancellationToken);
                    break;
                }

                using var document = JsonDocument.Parse(buffer.AsMemory(0, result.Count));
                var root = document.RootElement;
                var type = root.TryGetProperty("type", out var typeElement)
                    ? typeElement.GetString() : null;
                if (type is not ("offer" or "answer" or "ice")) continue;
                if (!root.TryGetProperty("target", out var targetElement)
                    || !Guid.TryParse(targetElement.GetString(), out var target)) continue;
                var payload = root.TryGetProperty("payload", out var payloadElement)
                    ? payloadElement.Clone() : default;
                await RelayAsync(room, target, new { type, sender = userId, payload }, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (WebSocketException)
        {
        }
        finally
        {
            room.TryRemove(connectionId, out _);
            if (room.IsEmpty) _rooms.TryRemove(channelId, out _);
            await BroadcastAsync(room, connectionId, new { type = "peer.left", userId },
                CancellationToken.None);
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "Fermeture",
                    CancellationToken.None);
            socket.Dispose();
        }
    }

    private static Task RelayAsync(
        ConcurrentDictionary<Guid, Client> room, Guid target, object message,
        CancellationToken cancellationToken) =>
        Task.WhenAll(room.Values.Where(client => client.UserId == target)
            .Select(client => SendAsync(client, message, cancellationToken)));

    private static Task BroadcastAsync(
        ConcurrentDictionary<Guid, Client> room, Guid excludedConnectionId,
        object message, CancellationToken cancellationToken) =>
        Task.WhenAll(room.Where(item => item.Key != excludedConnectionId)
            .Select(item => SendAsync(item.Value, message, cancellationToken)));

    private static async Task SendAsync(
        Client client, object message, CancellationToken cancellationToken)
    {
        if (client.Socket.State != WebSocketState.Open) return;
        var bytes = JsonSerializer.SerializeToUtf8Bytes(message);
        await client.SendLock.WaitAsync(cancellationToken);
        try
        {
            if (client.Socket.State == WebSocketState.Open)
                await client.Socket.SendAsync(bytes, WebSocketMessageType.Text, true, cancellationToken);
        }
        catch (WebSocketException)
        {
        }
        finally
        {
            client.SendLock.Release();
        }
    }

    private sealed record Client(Guid UserId, WebSocket Socket)
    {
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }
}
