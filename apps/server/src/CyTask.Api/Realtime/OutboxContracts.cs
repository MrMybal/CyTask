namespace CyTask.Api.Realtime;

public sealed record WorkspaceEventReplay(
    bool CursorFound,
    IReadOnlyList<WorkspaceEvent> Events,
    bool HasMore);

public sealed record OutboxDelivery(WorkspaceEvent Event, int Attempts);

public interface IWorkspaceEventReplayStore
{
    Task<WorkspaceEventReplay> ReplayAfterAsync(
        Guid organizationId,
        Guid? afterEventId,
        int limit,
        CancellationToken cancellationToken);
}

public interface IOutboxEventStore : IWorkspaceEventReplayStore
{
    Task<IReadOnlyList<OutboxDelivery>> ClaimBatchAsync(
        int limit,
        DateTimeOffset now,
        DateTimeOffset lockedUntil,
        CancellationToken cancellationToken);

    Task MarkProcessedAsync(Guid eventId, DateTimeOffset processedAt, CancellationToken cancellationToken);

    Task MarkFailedAsync(
        Guid eventId,
        string failureMessage,
        DateTimeOffset availableAt,
        CancellationToken cancellationToken);

    Task<int> DeleteProcessedBeforeAsync(
        DateTimeOffset cutoff,
        int limit,
        CancellationToken cancellationToken);
}

public sealed class OutboxDispatchSignal : IDisposable
{
    private readonly SemaphoreSlim _signal = new(0, 1);

    public void Pulse()
    {
        try
        {
            _signal.Release();
        }
        catch (SemaphoreFullException)
        {
        }
    }

    public Task WaitAsync(TimeSpan timeout, CancellationToken cancellationToken) =>
        _signal.WaitAsync(timeout, cancellationToken);

    public void Dispose() => _signal.Dispose();
}
