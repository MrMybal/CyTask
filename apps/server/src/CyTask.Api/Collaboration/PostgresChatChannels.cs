using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<IReadOnlyList<ChatChannel>?> ListChannelsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, null, organizationId, projectId, cancellationToken))
            return null;
        await using var command = new NpgsqlCommand(
            """
            SELECT id,organization_id,project_id,name,slug,topic,created_by,created_at
            FROM chat_channels WHERE organization_id=@organization AND project_id=@project
            ORDER BY created_at,id;
            """, connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        var result = new List<ChatChannel>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadChannel(reader));
        return result;
    }

    public async Task<ChatChannel?> GetChannelAsync(
        Guid organizationId, Guid channelId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await GetChannelCoreAsync(
            connection, null, organizationId, channelId, cancellationToken);
    }

    public async Task<ChatChannel?> CreateChannelAsync(
        Guid organizationId, Guid projectId, string name, string slug, string topic,
        Guid createdBy, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, transaction, organizationId, projectId,
                cancellationToken)) return null;
        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO chat_channels(
              id,organization_id,project_id,name,slug,topic,created_by,created_at)
            SELECT @id,@organization,@project,@name,@slug,@topic,@creator,@now
            WHERE EXISTS(SELECT 1 FROM organization_members
              WHERE organization_id=@organization AND user_id=@creator)
            ON CONFLICT (project_id,slug) DO NOTHING;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("name", name);
        command.Parameters.AddWithValue("slug", slug);
        command.Parameters.AddWithValue("topic", topic);
        command.Parameters.AddWithValue("creator", createdBy);
        command.Parameters.AddWithValue("now", now);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            await using var existingCommand = new NpgsqlCommand(
                """
                SELECT id,organization_id,project_id,name,slug,topic,created_by,created_at
                FROM chat_channels WHERE organization_id=@organization
                  AND project_id=@project AND slug=@slug;
                """, connection);
            existingCommand.Parameters.AddWithValue("organization", organizationId);
            existingCommand.Parameters.AddWithValue("project", projectId);
            existingCommand.Parameters.AddWithValue("slug", slug);
            await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadChannel(reader) : null;
        }
        await InsertOutboxAsync(connection, transaction, organizationId,
            "chat.channel_created", id, new { id, projectId, name, slug }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(id, organizationId, projectId, name, slug, topic, createdBy, now);
    }

    private static async Task<ChatChannel?> GetChannelCoreAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction,
        Guid organizationId, Guid channelId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            """
            SELECT id,organization_id,project_id,name,slug,topic,created_by,created_at
            FROM chat_channels WHERE id=@id AND organization_id=@organization;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", channelId);
        command.Parameters.AddWithValue("organization", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadChannel(reader) : null;
    }
}
