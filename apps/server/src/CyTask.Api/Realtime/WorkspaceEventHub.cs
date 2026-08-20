using System.Collections.Concurrent;
using System.Threading.Channels;

namespace CyTask.Api.Realtime;

public sealed record WorkspaceEvent(
    Guid Id,
    Guid OrganizationId,
    string Type,
    Guid EntityId,
    DateTimeOffset OccurredAt);

public sealed class WorkspaceEventHub
{
    private readonly ConcurrentDictionary<Guid, Subscriber> _subscribers = new();

    public Subscription Subscribe(Guid organizationId)
    {
        var id = Guid.CreateVersion7();
        var channel = Channel.CreateBounded<WorkspaceEvent>(new BoundedChannelOptions(128)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false
        });
        _subscribers.TryAdd(id, new Subscriber(organizationId, channel));
        return new Subscription(channel.Reader, () => _subscribers.TryRemove(id, out _));
    }

    public void Publish(Guid organizationId, string type, Guid entityId)
    {
        var workspaceEvent = new WorkspaceEvent(
            Guid.CreateVersion7(), organizationId, type, entityId, DateTimeOffset.UtcNow);
        foreach (var subscriber in _subscribers.Values)
        {
            if (subscriber.OrganizationId == organizationId)
            {
                subscriber.Channel.Writer.TryWrite(workspaceEvent);
            }
        }
    }

    private sealed record Subscriber(Guid OrganizationId, Channel<WorkspaceEvent> Channel);

    public sealed class Subscription(ChannelReader<WorkspaceEvent> reader, Action dispose) : IDisposable
    {
        public ChannelReader<WorkspaceEvent> Reader { get; } = reader;

        public void Dispose() => dispose();
    }
}

