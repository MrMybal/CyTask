using System.Net.WebSockets;
using System.Text.Json;
using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Collaboration;

public sealed class ChatSignalHub(IOptions<CyTaskOptions> options)
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid, Dictionary<Guid, Client>> _rooms = [];
    private const int MaximumMessageBytes = 65_536;

    public async Task RunAsync(Guid channelId, Guid userId, WebSocket socket, CancellationToken cancellationToken)
    {
        var peerId = Guid.CreateVersion7();
        var client = new Client(peerId, userId, socket);
        Client[]? initial = null;
        lock (_gate)
        {
            if (!_rooms.TryGetValue(channelId, out var room)) _rooms[channelId] = room = [];
            if (room.Count < options.Value.CallMaxParticipants)
            {
                initial = room.Values.ToArray(); room[peerId] = client;
            }
        }
        if (initial is null)
        {
            await CloseAsync(socket, WebSocketCloseStatus.PolicyViolation, "Room is full"); socket.Dispose(); return;
        }
        try
        {
            await SendAsync(client, new { type = "presence", protocol = 2, peerId,
                peers = initial.Select(Presence) }, cancellationToken, initialPresence: true);
            client.Ready.TrySetResult();
            await BroadcastAsync(channelId, peerId, new { type = "peer.joined", peerId, userId, state = client.State }, cancellationToken);
            var buffer = new byte[MaximumMessageBytes];
            var windowStarted = DateTimeOffset.UtcNow;
            var messagesInWindow = 0;
            while (socket.State == WebSocketState.Open && !cancellationToken.IsCancellationRequested)
            {
                var count = 0;
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(new ArraySegment<byte>(buffer, count, buffer.Length - count), cancellationToken);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    if (result.MessageType != WebSocketMessageType.Text)
                    { await CloseAsync(socket, WebSocketCloseStatus.InvalidMessageType, "Text messages required"); return; }
                    count += result.Count;
                    if (!result.EndOfMessage && count == MaximumMessageBytes)
                    { await CloseAsync(socket, WebSocketCloseStatus.MessageTooBig, "Signal too large"); return; }
                } while (!result.EndOfMessage);

                var now = DateTimeOffset.UtcNow;
                if (now - windowStarted > TimeSpan.FromSeconds(10)) { windowStarted = now; messagesInWindow = 0; }
                if (++messagesInWindow > 256)
                { await CloseAsync(socket, WebSocketCloseStatus.PolicyViolation, "Too many signals"); return; }
                using var document = JsonDocument.Parse(buffer.AsMemory(0, count));
                var root = document.RootElement;
                if (root.ValueKind != JsonValueKind.Object || !root.TryGetProperty("type", out var kind)
                    || kind.ValueKind != JsonValueKind.String) continue;
                var type = kind.GetString();
                if (type == "media-state")
                {
                    if (!root.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.Object
                        || !Boolean(state, "muted", out var muted) || !Boolean(state, "camera", out var camera)
                        || !Boolean(state, "screen", out var screen)) continue;
                    lock (_gate) client.State = new(muted, camera, screen);
                    await BroadcastAsync(channelId, peerId, new { type, sender = peerId, state = client.State }, cancellationToken);
                    continue;
                }
                if (type is not ("offer" or "answer" or "ice")
                    || !root.TryGetProperty("target", out var targetElement) || targetElement.ValueKind != JsonValueKind.String
                    || !Guid.TryParse(targetElement.GetString(), out var target) || target == peerId
                    || !root.TryGetProperty("payload", out var payload) || payload.ValueKind != JsonValueKind.Object) continue;
                if (type is "offer" or "answer")
                {
                    if (!payload.TryGetProperty("type", out var descriptionType) || descriptionType.ValueKind != JsonValueKind.String || descriptionType.GetString() != type
                        || !payload.TryGetProperty("sdp", out var sdp) || sdp.ValueKind != JsonValueKind.String || sdp.GetString()?.Length > 48_000) continue;
                }
                else if (!payload.TryGetProperty("candidate", out var candidate) || candidate.ValueKind != JsonValueKind.String || candidate.GetString()?.Length > 4000) continue;
                Client? recipient;
                lock (_gate) recipient = _rooms.GetValueOrDefault(channelId)?.GetValueOrDefault(target);
                if (recipient is not null)
                    await SendAsync(recipient, new { type, sender = peerId, payload }, cancellationToken);
            }
        }
        catch (JsonException) { await CloseAsync(socket, WebSocketCloseStatus.InvalidPayloadData, "Invalid signal"); }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested) { }
        catch (WebSocketException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) { }
        finally
        {
            client.Ready.TrySetResult();
            lock (_gate)
            {
                if (_rooms.TryGetValue(channelId, out var room))
                { room.Remove(peerId); if (room.Count == 0) _rooms.Remove(channelId); }
            }
            await BroadcastAsync(channelId, peerId, new { type = "peer.left", peerId, userId }, CancellationToken.None);
            await CloseAsync(socket, WebSocketCloseStatus.NormalClosure, "Call ended"); socket.Dispose();
        }
    }

    private static object Presence(Client client) => new { client.PeerId, client.UserId, client.State };
    private static bool Boolean(JsonElement element, string name, out bool value)
    {
        value = false;
        if (!element.TryGetProperty(name, out var property) || property.ValueKind is not (JsonValueKind.True or JsonValueKind.False)) return false;
        value = property.GetBoolean(); return true;
    }
    private Task BroadcastAsync(Guid channelId, Guid excluded, object message, CancellationToken cancellationToken)
    {
        Client[] clients;
        lock (_gate) clients = _rooms.TryGetValue(channelId, out var room) ? room.Values.Where(x => x.PeerId != excluded).ToArray() : [];
        return Task.WhenAll(clients.Select(client => SendAsync(client, message, cancellationToken)));
    }
    private static async Task SendAsync(Client client, object message, CancellationToken cancellationToken, bool initialPresence = false)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(5)); var locked = false;
        try
        {
            // A concurrently joining peer must always learn its own ID before
            // receiving other participants' notifications or offers.
            if (!initialPresence) await client.Ready.Task.WaitAsync(timeout.Token);
            await client.SendLock.WaitAsync(timeout.Token); locked = true;
            if (client.Socket.State == WebSocketState.Open)
                await client.Socket.SendAsync(JsonSerializer.SerializeToUtf8Bytes(message, Json), WebSocketMessageType.Text, true, timeout.Token);
        }
        catch (OperationCanceledException) { if (!cancellationToken.IsCancellationRequested) Abort(client.Socket); }
        catch (WebSocketException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) { }
        finally { if (locked) client.SendLock.Release(); }
    }
    private static async Task CloseAsync(WebSocket socket, WebSocketCloseStatus status, string reason)
    {
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await socket.CloseOutputAsync(status, reason, timeout.Token);
        }
        catch (OperationCanceledException) { Abort(socket); }
        catch (WebSocketException) { }
        catch (ObjectDisposedException) { }
        catch (IOException) { }
    }
    private static void Abort(WebSocket socket)
    {
        try { socket.Abort(); }
        catch (ObjectDisposedException) { }
    }
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private sealed record MediaState(bool Muted, bool Camera, bool Screen);
    private sealed record Client(Guid PeerId, Guid UserId, WebSocket Socket)
    {
        public MediaState State { get; set; } = new(true, false, false);
        public TaskCompletionSource Ready { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);
        public SemaphoreSlim SendLock { get; } = new(1, 1);
    }
}
