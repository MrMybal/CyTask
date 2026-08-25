using CyTask.Api.Realtime;
using Npgsql;

namespace CyTask.Api.Infrastructure;

public sealed class PostgresOutboxEventStore(NpgsqlDataSource dataSource) : IOutboxEventStore
{
    public async Task<IReadOnlyList<OutboxDelivery>> ClaimBatchAsync(
        int limit,
        DateTimeOffset now,
        DateTimeOffset lockedUntil,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            WITH candidates AS (
                SELECT id
                FROM outbox_events
                WHERE processed_at IS NULL
                  AND available_at <= @now
                  AND (locked_until IS NULL OR locked_until <= @now)
                ORDER BY created_at, id
                FOR UPDATE SKIP LOCKED
                LIMIT @limit
            )
            UPDATE outbox_events AS events
            SET locked_until = @locked_until,
                attempts = events.attempts + 1
            FROM candidates
            WHERE events.id = candidates.id
            RETURNING events.id,
                      events.organization_id,
                      events.event_type,
                      events.aggregate_id,
                      events.created_at,
                      events.attempts;
            """);
        command.Parameters.AddWithValue("now", now);
        command.Parameters.AddWithValue("locked_until", lockedUntil);
        command.Parameters.AddWithValue("limit", limit);

        var deliveries = new List<OutboxDelivery>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            deliveries.Add(new OutboxDelivery(
                new WorkspaceEvent(
                    reader.GetGuid(0),
                    reader.GetGuid(1),
                    reader.GetString(2),
                    reader.GetGuid(3),
                    reader.GetFieldValue<DateTimeOffset>(4)),
                reader.GetInt32(5)));
        }

        return deliveries;
    }

    public async Task MarkProcessedAsync(
        Guid eventId,
        DateTimeOffset processedAt,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE outbox_events
            SET processed_at = @processed_at,
                locked_until = NULL,
                last_error = NULL
            WHERE id = @id;
            """);
        command.Parameters.AddWithValue("id", eventId);
        command.Parameters.AddWithValue("processed_at", processedAt);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task MarkFailedAsync(
        Guid eventId,
        string failureMessage,
        DateTimeOffset availableAt,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE outbox_events
            SET available_at = @available_at,
                locked_until = NULL,
                last_error = @last_error
            WHERE id = @id
              AND processed_at IS NULL;
            """);
        command.Parameters.AddWithValue("id", eventId);
        command.Parameters.AddWithValue("available_at", availableAt);
        command.Parameters.AddWithValue(
            "last_error",
            failureMessage.Length <= 1000 ? failureMessage : failureMessage[..1000]);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<WorkspaceEventReplay> ReplayAfterAsync(
        Guid organizationId,
        Guid? afterEventId,
        int limit,
        CancellationToken cancellationToken)
    {
        if (afterEventId is null)
        {
            return new WorkspaceEventReplay(true, [], false);
        }

        DateTimeOffset? cursorCreatedAt;
        await using (var cursorCommand = dataSource.CreateCommand("""
                         SELECT created_at
                         FROM outbox_events
                         WHERE id = @id
                           AND organization_id = @organization_id;
                         """))
        {
            cursorCommand.Parameters.AddWithValue("id", afterEventId.Value);
            cursorCommand.Parameters.AddWithValue("organization_id", organizationId);
            var cursorValue = await cursorCommand.ExecuteScalarAsync(cancellationToken);
            cursorCreatedAt = cursorValue is DateTimeOffset value ? value : null;
        }

        if (cursorCreatedAt is null)
        {
            return new WorkspaceEventReplay(false, [], false);
        }

        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, event_type, aggregate_id, created_at
            FROM outbox_events
            WHERE organization_id = @organization_id
              AND (created_at, id) > (@created_at, @id)
            ORDER BY created_at, id
            LIMIT @limit;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("created_at", cursorCreatedAt.Value);
        command.Parameters.AddWithValue("id", afterEventId.Value);
        command.Parameters.AddWithValue("limit", limit + 1);

        var replay = new List<WorkspaceEvent>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            replay.Add(new WorkspaceEvent(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetGuid(3),
                reader.GetFieldValue<DateTimeOffset>(4)));
        }

        var hasMore = replay.Count > limit;
        return new WorkspaceEventReplay(true, replay.Take(limit).ToArray(), hasMore);
    }

    public async Task<int> DeleteProcessedBeforeAsync(
        DateTimeOffset cutoff,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            WITH expired AS (
                SELECT id
                FROM outbox_events
                WHERE processed_at < @cutoff
                ORDER BY processed_at, id
                LIMIT @limit
            )
            DELETE FROM outbox_events AS events
            USING expired
            WHERE events.id = expired.id;
            """);
        command.Parameters.AddWithValue("cutoff", cutoff);
        command.Parameters.AddWithValue("limit", limit);
        return await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
