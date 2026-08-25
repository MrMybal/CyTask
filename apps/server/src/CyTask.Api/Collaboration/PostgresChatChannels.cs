using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<IReadOnlyList<ChatChannel>?> ListChannelsAsync(
        Guid organizationId, Guid projectId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, null, organizationId, projectId, cancellationToken))
            return null;
        await SetTenantContextAsync(connection, null, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT c.id,c.organization_id,c.project_id,c.name,c.slug,c.topic,c.channel_type,
              ARRAY(SELECT cm.user_id FROM chat_channel_members cm
                    WHERE cm.organization_id=@organization AND cm.channel_id=c.id
                    ORDER BY cm.user_id),
              c.created_by,c.created_at
            FROM chat_channels c
            WHERE c.organization_id=@organization AND c.project_id=@project
              AND (c.channel_type='channel' OR EXISTS(
                SELECT 1 FROM chat_channel_members cm
                WHERE cm.organization_id=@organization
                  AND cm.channel_id=c.id AND cm.user_id=@user))
            ORDER BY c.created_at,c.id;
            """, connection);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        var result = new List<ChatChannel>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadChannel(reader));
        return result;
    }

    public async Task<ChatChannel?> GetChannelAsync(
        Guid organizationId, Guid channelId, Guid userId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await GetChannelCoreAsync(
            connection, null, organizationId, channelId, userId, cancellationToken);
    }

    public async Task<ChatChannel?> CreateChannelAsync(
        Guid organizationId, Guid projectId, string name, string slug, string topic,
        string channelType, IReadOnlyList<Guid> memberIds, Guid createdBy,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, transaction, organizationId, projectId,
                cancellationToken)) return null;
        await SetTenantContextAsync(connection, transaction, organizationId, cancellationToken);
        var requestedMembers = channelType == "group"
            ? memberIds.Append(createdBy).Distinct().ToArray()
            : [];
        var validMembers = await ValidMentionsAsync(connection, transaction, organizationId,
            requestedMembers, cancellationToken);
        if (validMembers.Length != requestedMembers.Length) return null;
        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO chat_channels(
              id,organization_id,project_id,name,slug,topic,channel_type,created_by,created_at)
            SELECT @id,@organization,@project,@name,@slug,@topic,@type,@creator,@now
            WHERE EXISTS(SELECT 1 FROM organization_members
              WHERE organization_id=@organization AND user_id=@creator)
            ON CONFLICT (project_id,slug) DO NOTHING;
            """, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("name", name);
        command.Parameters.AddWithValue("type", channelType);
        command.Parameters.AddWithValue("slug", slug);
        command.Parameters.AddWithValue("topic", topic);
        command.Parameters.AddWithValue("creator", createdBy);
        command.Parameters.AddWithValue("now", now);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            await SetTenantContextAsync(connection, null, organizationId, cancellationToken);
            await using var existingCommand = new NpgsqlCommand(
                """
                SELECT c.id,c.organization_id,c.project_id,c.name,c.slug,c.topic,c.channel_type,
                  ARRAY(SELECT cm.user_id FROM chat_channel_members cm
                        WHERE cm.organization_id=@organization AND cm.channel_id=c.id
                        ORDER BY cm.user_id),
                  c.created_by,c.created_at
                FROM chat_channels c WHERE c.organization_id=@organization
                  AND c.project_id=@project AND c.slug=@slug
                  AND (c.channel_type='channel' OR EXISTS(
                    SELECT 1 FROM chat_channel_members cm
                    WHERE cm.organization_id=@organization
                      AND cm.channel_id=c.id AND cm.user_id=@creator));
                """, connection);
            existingCommand.Parameters.AddWithValue("organization", organizationId);
            existingCommand.Parameters.AddWithValue("creator", createdBy);
            existingCommand.Parameters.AddWithValue("project", projectId);
            existingCommand.Parameters.AddWithValue("slug", slug);
            await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            return await reader.ReadAsync(cancellationToken) ? ReadChannel(reader) : null;
        }
        foreach (var memberId in validMembers)
        {
            await using var memberCommand = new NpgsqlCommand(
                """
                INSERT INTO chat_channel_members(organization_id,channel_id,user_id)
                VALUES (@organization,@channel,@user);
                """, connection, transaction);
            memberCommand.Parameters.AddWithValue("channel", id);
            memberCommand.Parameters.AddWithValue("user", memberId);
            memberCommand.Parameters.AddWithValue("organization", organizationId);
            await memberCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        await InsertOutboxAsync(connection, transaction, organizationId,
            "chat.channel_created", id, new { id, projectId, name, slug }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(id, organizationId, projectId, name, slug, topic, channelType,
            validMembers, createdBy, now);
    }

    private static async Task<ChatChannel?> GetChannelCoreAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction,
        Guid organizationId, Guid channelId, Guid userId, CancellationToken cancellationToken)
    {
        await SetTenantContextAsync(connection, transaction, organizationId, cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            SELECT c.id,c.organization_id,c.project_id,c.name,c.slug,c.topic,c.channel_type,
              ARRAY(SELECT cm.user_id FROM chat_channel_members cm
                    WHERE cm.organization_id=@organization AND cm.channel_id=c.id
                    ORDER BY cm.user_id),
              c.created_by,c.created_at
            FROM chat_channels c WHERE c.id=@id AND c.organization_id=@organization
              AND (c.channel_type='channel' OR EXISTS(
                SELECT 1 FROM chat_channel_members cm
                WHERE cm.organization_id=@organization
                  AND cm.channel_id=c.id AND cm.user_id=@user));
            """, connection, transaction);
        command.Parameters.AddWithValue("id", channelId);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("user", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadChannel(reader) : null;
    }
}
