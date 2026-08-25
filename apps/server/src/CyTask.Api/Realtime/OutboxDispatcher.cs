using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Realtime;

public sealed partial class OutboxDispatcher(
    IOutboxEventStore store,
    WorkspaceEventHub events,
    OutboxDispatchSignal signal,
    IOptions<CyTaskOptions> options,
    ILogger<OutboxDispatcher> logger) : BackgroundService
{
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var nextCleanup = DateTimeOffset.UtcNow;
        while (!stoppingToken.IsCancellationRequested)
        {
            var dispatched = 0;
            try
            {
                int batchCount;
                do
                {
                    batchCount = await DispatchBatchAsync(stoppingToken);
                    dispatched += batchCount;
                }
                while (batchCount == options.Value.OutboxBatchSize);

                var now = DateTimeOffset.UtcNow;
                if (now >= nextCleanup)
                {
                    await DeleteExpiredEventsAsync(now, stoppingToken);
                    nextCleanup = now.Add(CleanupInterval);
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                LogDispatchCycleFailed(logger, exception);
            }

            if (dispatched == 0)
            {
                await signal.WaitAsync(
                    TimeSpan.FromMilliseconds(options.Value.OutboxPollMilliseconds),
                    stoppingToken);
            }
        }
    }

    public async Task<int> DispatchBatchAsync(CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var deliveries = await store.ClaimBatchAsync(
            options.Value.OutboxBatchSize,
            now,
            now.AddSeconds(options.Value.OutboxLeaseSeconds),
            cancellationToken);

        foreach (var delivery in deliveries)
        {
            try
            {
                events.PublishFromOutbox(delivery.Event);
                await store.MarkProcessedAsync(
                    delivery.Event.Id,
                    DateTimeOffset.UtcNow,
                    cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                LogDeliveryFailed(
                    logger,
                    delivery.Event.Id,
                    delivery.Attempts,
                    exception);
                var delaySeconds = Math.Min(60, Math.Pow(2, Math.Min(delivery.Attempts, 6)));
                await store.MarkFailedAsync(
                    delivery.Event.Id,
                    exception.Message,
                    DateTimeOffset.UtcNow.AddSeconds(delaySeconds),
                    cancellationToken);
            }
        }

        return deliveries.Count;
    }

    private async Task DeleteExpiredEventsAsync(DateTimeOffset now, CancellationToken cancellationToken)
    {
        var cutoff = now.AddDays(-options.Value.OutboxRetentionDays);
        var total = 0;
        int deleted;
        do
        {
            deleted = await store.DeleteProcessedBeforeAsync(cutoff, 1000, cancellationToken);
            total += deleted;
        }
        while (deleted == 1000 && total < 10_000);

        if (total > 0)
        {
            LogExpiredEventsDeleted(logger, total);
        }
    }

    [LoggerMessage(1, LogLevel.Error, "Outbox dispatch cycle failed")]
    private static partial void LogDispatchCycleFailed(ILogger logger, Exception exception);

    [LoggerMessage(2, LogLevel.Warning,
        "Outbox event {EventId} delivery failed on attempt {Attempt}")]
    private static partial void LogDeliveryFailed(
        ILogger logger,
        Guid eventId,
        int attempt,
        Exception exception);

    [LoggerMessage(3, LogLevel.Information, "Deleted {Count} expired outbox events")]
    private static partial void LogExpiredEventsDeleted(ILogger logger, int count);
}
