using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<ChatChannel?> FindMessageChannelAsync(Guid organizationId, Guid messageId,
        Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await SetTenantContextAsync(connection, null, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT channel_id FROM chat_messages
            WHERE organization_id=@organization AND id=@message;
            """, connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("message", messageId);
        var id = await command.ExecuteScalarAsync(cancellationToken);
        return id is Guid channelId
            ? await GetChannelCoreAsync(connection, null, organizationId, channelId, userId, cancellationToken)
            : null;
    }
}
