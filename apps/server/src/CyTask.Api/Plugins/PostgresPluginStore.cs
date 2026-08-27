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


    public async Task<IReadOnlyList<AiProviderConnection>> ListAiProviderConnectionsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, project_id, name, provider, model, base_url,
                   protected_secret, secret_hint, revision, created_by, created_at,
                   updated_by, updated_at
            FROM ai_provider_connections
            WHERE organization_id = @organization_id AND project_id = @project_id
            ORDER BY lower(name), id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<AiProviderConnection>();
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadAiProviderConnection(reader));
        return result;
    }

    public async Task<AiProviderConnection?> GetAiProviderConnectionAsync(
        Guid organizationId, Guid projectId, Guid connectionId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, project_id, name, provider, model, base_url,
                   protected_secret, secret_hint, revision, created_by, created_at,
                   updated_by, updated_at
            FROM ai_provider_connections
            WHERE organization_id = @organization_id
              AND project_id = @project_id
              AND id = @id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("id", connectionId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAiProviderConnection(reader) : null;
    }

    public async Task<AiProviderConnection> CreateAiProviderConnectionAsync(
        AiProviderConnection connection, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            INSERT INTO ai_provider_connections(
                id, organization_id, project_id, name, provider, model, base_url,
                protected_secret, secret_hint, revision, created_by, created_at,
                updated_by, updated_at)
            VALUES (@id, @organization_id, @project_id, @name, @provider, @model, @base_url,
                    @protected_secret, @secret_hint, 1, @created_by, @created_at,
                    @updated_by, @updated_at)
            RETURNING id, organization_id, project_id, name, provider, model, base_url,
                      protected_secret, secret_hint, revision, created_by, created_at,
                      updated_by, updated_at;
            """);
        AddAiParameters(command, connection);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        await reader.ReadAsync(cancellationToken);
        return ReadAiProviderConnection(reader);
    }

    public async Task<AiProviderConnection?> UpdateAiProviderConnectionAsync(
        AiProviderConnection connection, long expectedRevision,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE ai_provider_connections
            SET name = @name,
                provider = @provider,
                model = @model,
                base_url = @base_url,
                protected_secret = @protected_secret,
                secret_hint = @secret_hint,
                revision = revision + 1,
                updated_by = @updated_by,
                updated_at = @updated_at
            WHERE id = @id
              AND organization_id = @organization_id
              AND project_id = @project_id
              AND revision = @expected_revision
            RETURNING id, organization_id, project_id, name, provider, model, base_url,
                      protected_secret, secret_hint, revision, created_by, created_at,
                      updated_by, updated_at;
            """);
        AddAiParameters(command, connection);
        command.Parameters.AddWithValue("expected_revision", expectedRevision);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAiProviderConnection(reader) : null;
    }

    public async Task<bool> DeleteAiProviderConnectionAsync(
        Guid organizationId, Guid projectId, Guid connectionId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            DELETE FROM ai_provider_connections
            WHERE id = @id AND organization_id = @organization_id AND project_id = @project_id;
            """);
        command.Parameters.AddWithValue("id", connectionId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private static void AddAiParameters(NpgsqlCommand command, AiProviderConnection connection)
    {
        command.Parameters.AddWithValue("id", connection.Id);
        command.Parameters.AddWithValue("organization_id", connection.OrganizationId);
        command.Parameters.AddWithValue("project_id", connection.ProjectId);
        command.Parameters.AddWithValue("name", connection.Name);
        command.Parameters.AddWithValue("provider", connection.Provider);
        command.Parameters.AddWithValue("model", connection.Model);
        command.Parameters.AddWithValue("base_url", (object?)connection.BaseUrl ?? DBNull.Value);
        command.Parameters.AddWithValue("protected_secret", (object?)connection.ProtectedSecret ?? DBNull.Value);
        command.Parameters.AddWithValue("secret_hint", (object?)connection.SecretHint ?? DBNull.Value);
        command.Parameters.AddWithValue("created_by", connection.CreatedBy);
        command.Parameters.AddWithValue("created_at", connection.CreatedAt);
        command.Parameters.AddWithValue("updated_by", connection.UpdatedBy);
        command.Parameters.AddWithValue("updated_at", connection.UpdatedAt);
    }

    private static AiProviderConnection ReadAiProviderConnection(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
        reader.GetString(4), reader.GetString(5), reader.IsDBNull(6) ? null : reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8), reader.GetInt64(9),
        reader.GetGuid(10), reader.GetFieldValue<DateTimeOffset>(11),
        reader.GetGuid(12), reader.GetFieldValue<DateTimeOffset>(13));
    private static TaskPluginData ReadTaskPluginData(NpgsqlDataReader reader)
    {
        using var document = JsonDocument.Parse(reader.GetString(4));
        return new(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
            document.RootElement.Clone(), reader.GetInt64(5), reader.GetGuid(6),
            reader.GetFieldValue<DateTimeOffset>(7));
    }
}
