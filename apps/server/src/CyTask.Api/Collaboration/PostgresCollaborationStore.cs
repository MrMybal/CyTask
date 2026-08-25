using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore(NpgsqlDataSource dataSource) : ICollaborationStore
{
    private const string ResourceColumns = """
        r.id, r.organization_id, r.project_id, r.folder_label_id, r.resource_type, r.name,
        r.body, r.declared_content_type, r.detected_content_type, r.size_bytes, r.sha256,
        r.status, r.rejection_reason, r.revision, r.created_by, u.display_name,
        r.created_at, r.updated_at
        """;

    private static ProjectResource ReadResource(NpgsqlDataReader reader, int offset = 0) => new(
        reader.GetGuid(offset), reader.GetGuid(offset + 1), reader.GetGuid(offset + 2),
        reader.IsDBNull(offset + 3) ? null : reader.GetGuid(offset + 3),
        reader.GetString(offset + 4), reader.GetString(offset + 5), reader.GetString(offset + 6),
        reader.IsDBNull(offset + 7) ? null : reader.GetString(offset + 7),
        reader.IsDBNull(offset + 8) ? null : reader.GetString(offset + 8),
        reader.GetInt64(offset + 9), reader.IsDBNull(offset + 10) ? null : reader.GetString(offset + 10),
        reader.GetString(offset + 11), reader.IsDBNull(offset + 12) ? null : reader.GetString(offset + 12),
        reader.GetInt64(offset + 13), reader.GetGuid(offset + 14), reader.GetString(offset + 15),
        reader.GetFieldValue<DateTimeOffset>(offset + 16),
        reader.GetFieldValue<DateTimeOffset>(offset + 17));

    private static ChatChannel ReadChannel(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
        reader.GetString(4), reader.GetString(5), reader.GetString(6),
        reader.GetFieldValue<Guid[]>(7), reader.GetGuid(8),
        reader.GetFieldValue<DateTimeOffset>(9));

    private static async Task<IReadOnlyList<ProjectResource>> ReadResourcesAsync(
        NpgsqlCommand command, CancellationToken cancellationToken)
    {
        var result = new List<ProjectResource>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadResource(reader));
        return result;
    }

    private static async Task SetTenantContextAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction? transaction,
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT set_config('cytask.organization_id', @organization, @transaction_local);
            """, connection, transaction);
        command.Parameters.AddWithValue("organization", organizationId.ToString());
        command.Parameters.AddWithValue("transaction_local", transaction is not null);
        await command.ExecuteScalarAsync(cancellationToken);
    }

    private static async Task<bool> ProjectExistsAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction,
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT EXISTS(SELECT 1 FROM projects WHERE id=@project AND organization_id=@organization);",
            connection, transaction);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("organization", organizationId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task<bool> FolderExistsAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction,
        Guid organizationId, Guid projectId, Guid? folderId, CancellationToken cancellationToken)
    {
        if (folderId is null) return true;
        await using var command = new NpgsqlCommand(
            """
            SELECT EXISTS(SELECT 1 FROM project_labels
              WHERE id=@folder AND organization_id=@organization AND project_id=@project);
            """, connection, transaction);
        command.Parameters.AddWithValue("folder", folderId.Value);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static Task<int> InsertOutboxAsync<T>(
        NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid organizationId, string eventType, Guid aggregateId, T payload,
        CancellationToken cancellationToken)
    {
        var command = new NpgsqlCommand(
            """
            INSERT INTO outbox_events(id,organization_id,event_type,aggregate_id,payload,created_at)
            VALUES (@id,@organization,@type,@aggregate,@payload::jsonb,@created_at);
            """, connection, transaction);
        command.Parameters.AddWithValue("id", Guid.CreateVersion7());
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("type", eventType);
        command.Parameters.AddWithValue("aggregate", aggregateId);
        command.Parameters.AddWithValue("payload", JsonSerializer.Serialize(payload));
        command.Parameters.AddWithValue("created_at", DateTimeOffset.UtcNow);
        return command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static void AddNullableUuid(NpgsqlCommand command, string name, Guid? value) =>
        command.Parameters.Add(name, NpgsqlDbType.Uuid).Value =
            value is null ? DBNull.Value : value.Value;
}
