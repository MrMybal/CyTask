using System.Text.Json;
using Npgsql;

namespace CyTask.Api.Plugins;

public sealed class PostgresPluginStore(NpgsqlDataSource dataSource) : IPluginStore
{
    public async Task<IReadOnlyList<ProjectPluginState>> ListProjectPluginsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT organization_id, project_id, plugin_id, enabled_by, enabled_at
            FROM project_plugins
            WHERE organization_id = @organization_id AND project_id = @project_id
            ORDER BY plugin_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var plugins = new List<ProjectPluginState>();
        while (await reader.ReadAsync(cancellationToken))
        {
            plugins.Add(new(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), true,
                reader.GetGuid(3), reader.GetFieldValue<DateTimeOffset>(4)));
        }

        return plugins;
    }

    public async Task<ProjectPluginState> EnableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId, Guid userId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            INSERT INTO project_plugins(
                organization_id, project_id, plugin_id, enabled_by, enabled_at)
            VALUES (@organization_id, @project_id, @plugin_id, @enabled_by, now())
            ON CONFLICT (project_id, plugin_id) DO UPDATE
            SET enabled_by = EXCLUDED.enabled_by,
                enabled_at = project_plugins.enabled_at
            RETURNING organization_id, project_id, plugin_id, enabled_by, enabled_at;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("plugin_id", pluginId);
        command.Parameters.AddWithValue("enabled_by", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return new(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), true,
            reader.GetGuid(3), reader.GetFieldValue<DateTimeOffset>(4));
    }

    public async Task<bool> DisableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            DELETE FROM project_plugins
            WHERE organization_id = @organization_id
              AND project_id = @project_id
              AND plugin_id = @plugin_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("plugin_id", pluginId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<TaskPluginData?> GetTaskPluginDataAsync(
        Guid organizationId, Guid taskId, string pluginId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT organization_id, project_id, task_id, plugin_id, data::text,
                   revision, updated_by, updated_at
            FROM task_plugin_data
            WHERE organization_id = @organization_id
              AND task_id = @task_id
              AND plugin_id = @plugin_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("plugin_id", pluginId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTaskPluginData(reader) : null;
    }

    public async Task<IReadOnlyList<TaskPluginData>> ListTaskPluginDataHistoryAsync(
        Guid organizationId, Guid taskId, string pluginId, int limit,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT organization_id, project_id, task_id, plugin_id, data::text,
                   revision, updated_by, updated_at
            FROM task_plugin_data_history
            WHERE organization_id = @organization_id
              AND task_id = @task_id
              AND plugin_id = @plugin_id
            ORDER BY revision DESC
            LIMIT @limit;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("plugin_id", pluginId);
        command.Parameters.AddWithValue("limit", Math.Clamp(limit, 1, 100));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var history = new List<TaskPluginData>();
        while (await reader.ReadAsync(cancellationToken))
        {
            history.Add(ReadTaskPluginData(reader));
        }
        return history;
    }

    public async Task<TaskPluginData?> UpsertTaskPluginDataAsync(
        Guid organizationId, Guid projectId, Guid taskId, string pluginId,
        JsonElement data, long expectedRevision, Guid userId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            WITH upserted AS (
                INSERT INTO task_plugin_data(
                    organization_id, project_id, task_id, plugin_id, data,
                    revision, updated_by, updated_at)
                SELECT @organization_id, @project_id, @task_id, @plugin_id,
                       @data::jsonb, 1, @updated_by, now()
                WHERE @expected_revision = 0
                ON CONFLICT (task_id, plugin_id) DO UPDATE
                SET data = EXCLUDED.data,
                    revision = task_plugin_data.revision + 1,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = now()
                WHERE task_plugin_data.organization_id = @organization_id
                  AND task_plugin_data.project_id = @project_id
                  AND task_plugin_data.revision = @expected_revision
                RETURNING organization_id, project_id, task_id, plugin_id, data,
                          revision, updated_by, updated_at
            ), archived AS (
                INSERT INTO task_plugin_data_history(
                    organization_id, project_id, task_id, plugin_id, data,
                    revision, updated_by, updated_at)
                SELECT organization_id, project_id, task_id, plugin_id, data,
                       revision, updated_by, updated_at
                FROM upserted
                ON CONFLICT (task_id, plugin_id, revision) DO NOTHING
                RETURNING revision
            )
            SELECT organization_id, project_id, task_id, plugin_id, data::text,
                   revision, updated_by, updated_at
            FROM upserted;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("plugin_id", pluginId);
        command.Parameters.AddWithValue("data", data.GetRawText());
        command.Parameters.AddWithValue("expected_revision", expectedRevision);
        command.Parameters.AddWithValue("updated_by", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTaskPluginData(reader) : null;
    }

    private static TaskPluginData ReadTaskPluginData(NpgsqlDataReader reader)
    {
        using var document = JsonDocument.Parse(reader.GetString(4));
        return new(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
            document.RootElement.Clone(), reader.GetInt64(5), reader.GetGuid(6),
            reader.GetFieldValue<DateTimeOffset>(7));
    }
}
