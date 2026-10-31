using System.Text.Json;
using CyTask.Api.Security;
using CyTask.Api.LocalSync;
using Npgsql;
using NpgsqlTypes;

namespace CyTask.Api.Spaces;

public sealed class InMemoryProjectSpaceStore(LocalStateClock clock) : IProjectSpaceStore
{
    private readonly Dictionary<Guid, ProjectSpaceState> _spaces = [];
    public Task<ProjectSpaceState?> GetAsync(Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (clock.Gate) return Task.FromResult(_spaces.TryGetValue(projectId, out var value)
            && value.OrganizationId == organizationId ? value : null);
    }
    public Task<bool> SaveAsync(ProjectSpaceState value, long expectedRevision, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        lock (clock.Gate)
        {
            var revision = _spaces.GetValueOrDefault(value.ProjectId)?.Revision ?? 0;
            if (revision != expectedRevision) return Task.FromResult(false);
            _spaces[value.ProjectId] = value;
            clock.Changed();
            return Task.FromResult(true);
        }
    }
    public ProjectSpaceState[] CaptureLocalState()
    {
        lock (clock.Gate) return _spaces.Values.OrderBy(x => x.ProjectId).ToArray();
    }
    public void RestoreLocalState(IReadOnlyList<ProjectSpaceState> values)
    {
        lock (clock.Gate) { _spaces.Clear(); foreach (var value in values) _spaces[value.ProjectId] = value; }
    }
}

public sealed class PostgresProjectSpaceStore(NpgsqlDataSource dataSource, DataEncryption encryption) : IProjectSpaceStore
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public async Task<ProjectSpaceState?> GetAsync(Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await TenantAsync(connection, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT body FROM project_spaces WHERE organization_id=@organization AND project_id=@project", connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        return await command.ExecuteScalarAsync(cancellationToken) is string body
            ? JsonSerializer.Deserialize<ProjectSpaceState>(encryption.Decode(body), Json) : null;
    }
    public async Task<bool> SaveAsync(ProjectSpaceState value, long expectedRevision, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await TenantAsync(connection, value.OrganizationId, cancellationToken);
        await using var command = new NpgsqlCommand("""
            INSERT INTO project_spaces(organization_id,project_id,body,revision)
            SELECT @organization,@project,@body,@revision WHERE @expected=0
            ON CONFLICT(project_id) DO UPDATE SET body=@body,revision=@revision
            WHERE project_spaces.organization_id=@organization AND project_spaces.revision=@expected;
            """, connection);
        // Existing rows need an UPDATE even when the INSERT's initial-revision guard is false.
        command.CommandText = expectedRevision == 0 ? command.CommandText : """
            UPDATE project_spaces SET body=@body,revision=@revision
            WHERE organization_id=@organization AND project_id=@project AND revision=@expected;
            """;
        command.CommandText = "WITH changed AS (" + command.CommandText.TrimEnd().TrimEnd(';') + " RETURNING project_id) " + """
            INSERT INTO outbox_events(id,organization_id,event_type,aggregate_id,payload,created_at)
            SELECT @event,@organization,'project.space_updated',project_id,'{}'::jsonb,now() FROM changed;
            """;
        command.Parameters.AddWithValue("event", Guid.CreateVersion7());
        command.Parameters.AddWithValue("organization", value.OrganizationId);
        command.Parameters.AddWithValue("project", value.ProjectId);
        command.Parameters.AddWithValue("body", NpgsqlDbType.Jsonb, encryption.Encode(JsonSerializer.Serialize(value, Json), true));
        command.Parameters.AddWithValue("revision", value.Revision);
        command.Parameters.AddWithValue("expected", expectedRevision);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }
    private static async Task TenantAsync(NpgsqlConnection connection, Guid organizationId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("SELECT set_config('cytask.organization_id',@organization,false)", connection);
        command.Parameters.AddWithValue("organization", organizationId.ToString());
        await command.ExecuteScalarAsync(cancellationToken);
    }
}
