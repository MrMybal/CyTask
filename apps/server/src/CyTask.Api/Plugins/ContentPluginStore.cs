using System.Text.Json;
using CyTask.Api.Security;
using CyTask.Api.LocalSync;
using Npgsql;
using NpgsqlTypes;

namespace CyTask.Api.Plugins;

public sealed record ContentPluginData(Guid OrganizationId, Guid ProjectId, string ContentKind,
    Guid ContentId, string PluginId, string ActionId, JsonElement Data, long Revision,
    Guid UpdatedBy, DateTimeOffset UpdatedAt)
{
    public string Key => $"{ProjectId:N}:{ContentKind}:{ContentId:N}:{PluginId}:{ActionId}";
}
public interface IContentPluginStore
{
    Task<ContentPluginData?> GetAsync(Guid organizationId, Guid projectId, string kind, Guid id,
        string pluginId, string actionId, CancellationToken cancellationToken);
    Task<ContentPluginData?> SaveAsync(ContentPluginData value, long expectedRevision, CancellationToken cancellationToken);
}
public sealed class InMemoryContentPluginStore(LocalStateClock clock) : IContentPluginStore
{
    private readonly Dictionary<string, ContentPluginData> _data = new(StringComparer.Ordinal);
    public Task<ContentPluginData?> GetAsync(Guid organizationId, Guid projectId, string kind, Guid id,
        string pluginId, string actionId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (clock.Gate)
        {
            var value = _data.GetValueOrDefault($"{projectId:N}:{kind}:{id:N}:{pluginId}:{actionId}");
            return Task.FromResult(value?.OrganizationId == organizationId ? value : null);
        }
    }
    public Task<ContentPluginData?> SaveAsync(ContentPluginData value, long expectedRevision, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (clock.Gate)
        {
            var current = _data.GetValueOrDefault(value.Key);
            if ((current?.Revision ?? 0) != expectedRevision || current is not null && current.OrganizationId != value.OrganizationId)
                return Task.FromResult<ContentPluginData?>(null);
            value = value with { Data = value.Data.Clone(), Revision = expectedRevision + 1 };
            _data[value.Key] = value;
            clock.Changed();
            return Task.FromResult<ContentPluginData?>(value);
        }
    }
    public ContentPluginData[] CaptureLocalState() { lock (clock.Gate) return _data.Values.OrderBy(x => x.Key, StringComparer.Ordinal).ToArray(); }
    public void RestoreLocalState(IReadOnlyList<ContentPluginData> values)
    {
        lock (clock.Gate) { _data.Clear(); foreach (var value in values) _data[value.Key] = value; }
    }
}
public sealed class PostgresContentPluginStore(NpgsqlDataSource dataSource, DataEncryption encryption) : IContentPluginStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<ContentPluginData?> GetAsync(Guid organizationId, Guid projectId, string kind, Guid id,
        string pluginId, string actionId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await TenantAsync(connection, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT body FROM content_plugin_data WHERE organization_id=@organization
            AND project_id=@project AND content_kind=@kind AND content_id=@id AND plugin_id=@plugin AND action_id=@action;
            """, connection);
        Bind(command, organizationId, projectId, kind, id, pluginId, actionId);
        return await command.ExecuteScalarAsync(cancellationToken) is string json ? JsonSerializer.Deserialize<ContentPluginData>(encryption.Decode(json), Json) : null;
    }
    public async Task<ContentPluginData?> SaveAsync(ContentPluginData value, long expectedRevision, CancellationToken cancellationToken)
    {
        value = value with { Revision = expectedRevision + 1 };
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await TenantAsync(connection, value.OrganizationId, cancellationToken);
        await using var command = new NpgsqlCommand(expectedRevision == 0 ? """
            INSERT INTO content_plugin_data(organization_id,project_id,content_kind,content_id,plugin_id,action_id,body,revision)
            VALUES(@organization,@project,@kind,@id,@plugin,@action,@body,@revision)
            ON CONFLICT(project_id,content_kind,content_id,plugin_id,action_id) DO NOTHING;
            """ : """
            UPDATE content_plugin_data SET body=@body,revision=@revision
            WHERE organization_id=@organization AND project_id=@project AND content_kind=@kind
            AND content_id=@id AND plugin_id=@plugin AND action_id=@action AND revision=@expected;
            """, connection);
        Bind(command, value.OrganizationId, value.ProjectId, value.ContentKind, value.ContentId, value.PluginId, value.ActionId);
        command.CommandText = "WITH changed AS (" + command.CommandText.TrimEnd().TrimEnd(';') + " RETURNING project_id) " + """
            INSERT INTO outbox_events(id,organization_id,event_type,aggregate_id,payload,created_at)
            SELECT @event,@organization,'project.content_plugin_updated',project_id,'{}'::jsonb,now() FROM changed;
            """;
        command.Parameters.AddWithValue("event", Guid.CreateVersion7());
        command.Parameters.AddWithValue("body", NpgsqlDbType.Jsonb, encryption.Encode(JsonSerializer.Serialize(value, Json), true));
        command.Parameters.AddWithValue("revision", value.Revision);
        command.Parameters.AddWithValue("expected", expectedRevision);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1 ? value : null;
    }
    private static void Bind(NpgsqlCommand command, Guid organizationId, Guid projectId, string kind, Guid id, string pluginId, string actionId)
    {
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("kind", kind);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("plugin", pluginId);
        command.Parameters.AddWithValue("action", actionId);
    }
    private static async Task TenantAsync(NpgsqlConnection connection, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT set_config('cytask.organization_id',@organization,false)", connection);
        command.Parameters.AddWithValue("organization", organizationId.ToString());
        await command.ExecuteScalarAsync(cancellationToken);
    }
}
