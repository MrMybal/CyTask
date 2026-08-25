using System.Collections.Concurrent;
using System.Threading.Channels;
using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Realtime;

public sealed record WorkspaceEvent(
    Guid Id,
    Guid OrganizationId,
    string Type,
    Guid EntityId,
    DateTimeOffset OccurredAt);

public sealed class WorkspaceEventHub(
    IOptions<CyTaskOptions> options,
    OutboxDispatchSignal dispatchSignal) : IWorkspaceEventReplayStore
{
    private const int HistoryCapacity = 4096;
    private const int DeduplicationCapacity = 16_384;
    private readonly ConcurrentDictionary<Guid, Subscriber> _subscribers = new();
    private readonly ConcurrentDictionary<Guid, byte> _delivered = new();
    private readonly ConcurrentQueue<Guid> _deliveredOrder = new();
    private readonly Dictionary<Guid, List<WorkspaceEvent>> _history = [];
    private readonly object _historyLock = new();

    public Subscription Subscribe(Guid organizationId)
    {
        var id = Guid.CreateVersion7();
        var channel = Channel.CreateBounded<WorkspaceEvent>(new BoundedChannelOptions(256)
        {
            FullMode = BoundedChannelFullMode.Wait,
            SingleReader = true,
            SingleWriter = false
        });
        _subscribers.TryAdd(id, new Subscriber(organizationId, channel));
        return new Subscription(channel.Reader, () => _subscribers.TryRemove(id, out _));
    }

    public void Publish(Guid organizationId, string type, Guid entityId)
    {
        if (!options.Value.UseInMemoryStore)
        {
            dispatchSignal.Pulse();
            return;
        }

        var workspaceEvent = new WorkspaceEvent(
            Guid.CreateVersion7(), organizationId, type, entityId, DateTimeOffset.UtcNow);
        AddToHistory(workspaceEvent);
        PublishEvent(workspaceEvent);
    }

    public bool PublishFromOutbox(WorkspaceEvent workspaceEvent)
    {
        if (!_delivered.TryAdd(workspaceEvent.Id, 0))
        {
            return false;
        }

        _deliveredOrder.Enqueue(workspaceEvent.Id);
        while (_deliveredOrder.Count > DeduplicationCapacity &&
               _deliveredOrder.TryDequeue(out var expiredId))
        {
            _delivered.TryRemove(expiredId, out _);
        }

        PublishEvent(workspaceEvent);
        return true;
    }

    public Task<WorkspaceEventReplay> ReplayAfterAsync(
        Guid organizationId,
        Guid? afterEventId,
        int limit,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (afterEventId is null)
        {
            return Task.FromResult(new WorkspaceEventReplay(true, [], false));
        }

        lock (_historyLock)
        {
            if (!_history.TryGetValue(organizationId, out var history))
            {
                return Task.FromResult(new WorkspaceEventReplay(false, [], false));
            }

            var cursorIndex = history.FindIndex(item => item.Id == afterEventId.Value);
            if (cursorIndex < 0)
            {
                return Task.FromResult(new WorkspaceEventReplay(false, [], false));
            }

            var replay = history.Skip(cursorIndex + 1).Take(limit + 1).ToArray();
            var hasMore = replay.Length > limit;
            return Task.FromResult(
                new WorkspaceEventReplay(true, replay.Take(limit).ToArray(), hasMore));
        }
    }

    private void AddToHistory(WorkspaceEvent workspaceEvent)
    {
        lock (_historyLock)
        {
            if (!_history.TryGetValue(workspaceEvent.OrganizationId, out var history))
            {
                history = [];
                _history.Add(workspaceEvent.OrganizationId, history);
            }

            history.Add(workspaceEvent);
            if (history.Count > HistoryCapacity)
            {
                history.RemoveRange(0, history.Count - HistoryCapacity);
            }
        }
    }

    private void PublishEvent(WorkspaceEvent workspaceEvent)
    {
        foreach (var subscriber in _subscribers.Values)
        {
            if (subscriber.OrganizationId == workspaceEvent.OrganizationId &&
                !subscriber.Channel.Writer.TryWrite(workspaceEvent))
            {
                subscriber.Channel.Writer.TryComplete();
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

