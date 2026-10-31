using CyTask.Api.Spaces;
using Npgsql;
namespace CyTask.Api.Collaboration;
public sealed partial class PostgresCollaborationStore
{
    public async Task<IReadOnlyList<RoomActivity>> ListChannelActivityAsync(
        Guid organizationId, Guid projectId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await SetTenantContextAsync(connection, null, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT c.id,MAX(m.created_at),COUNT(m.id) FROM chat_channels c
            LEFT JOIN chat_messages m ON m.channel_id=c.id AND m.organization_id=@organization
            WHERE c.organization_id=@organization AND c.project_id=@project
              AND (c.channel_type='channel' OR EXISTS(SELECT 1 FROM chat_channel_members cm
                WHERE cm.organization_id=@organization AND cm.channel_id=c.id AND cm.user_id=@user))
            GROUP BY c.id;
            """, connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("user", userId);
        var result = new List<RoomActivity>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(new(reader.GetGuid(0),
            reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1), reader.GetInt64(2)));
        return result;
    }
}
