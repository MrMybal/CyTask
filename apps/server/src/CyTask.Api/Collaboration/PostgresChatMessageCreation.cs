using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<ChatMessage?> CreateMessageAsync(
        Guid organizationId, Guid channelId, Guid authorId, string body,
        IReadOnlyList<Guid> resourceIds, IReadOnlyList<Guid> mentionedUserIds,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var channel = await GetChannelCoreAsync(
            connection, transaction, organizationId, channelId, cancellationToken);
        if (channel is null) return null;
        var attachments = resourceIds.Distinct().ToArray();
        if (!await ResourcesValidAsync(connection, transaction, organizationId,
                channel.ProjectId, attachments, cancellationToken)) return null;
        var mentions = await ValidMentionsAsync(connection, transaction, organizationId,
            mentionedUserIds.Distinct().ToArray(), cancellationToken);
        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        string? authorName;
        await using (var authorCommand = new NpgsqlCommand(
            """
            SELECT u.display_name
            FROM users u JOIN organization_members om ON om.user_id=u.id
            WHERE u.id=@author AND om.organization_id=@organization;
            """, connection, transaction))
        {
            authorCommand.Parameters.AddWithValue("organization", organizationId);
            authorCommand.Parameters.AddWithValue("author", authorId);
            authorName = await authorCommand.ExecuteScalarAsync(cancellationToken) as string;
        }
        if (authorName is null) return null;
        await using (var messageCommand = new NpgsqlCommand(
            """
            INSERT INTO chat_messages(id,organization_id,channel_id,author_id,body,created_at)
            VALUES (@id,@organization,@channel,@author,@body,@now);
            """, connection, transaction))
        {
            messageCommand.Parameters.AddWithValue("id", id);
            messageCommand.Parameters.AddWithValue("organization", organizationId);
            messageCommand.Parameters.AddWithValue("channel", channelId);
            messageCommand.Parameters.AddWithValue("author", authorId);
            messageCommand.Parameters.AddWithValue("body", body);
            messageCommand.Parameters.AddWithValue("now", now);
            await messageCommand.ExecuteNonQueryAsync(cancellationToken);
        }
        foreach (var resourceId in attachments)
        {
            await using var command = new NpgsqlCommand(
                "INSERT INTO chat_message_resources(message_id,resource_id) VALUES (@message,@resource);",
                connection, transaction);
            command.Parameters.AddWithValue("message", id);
            command.Parameters.AddWithValue("resource", resourceId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        foreach (var userId in mentions)
        {
            await using var command = new NpgsqlCommand(
                "INSERT INTO chat_mentions(message_id,user_id) VALUES (@message,@user);",
                connection, transaction);
            command.Parameters.AddWithValue("message", id);
            command.Parameters.AddWithValue("user", userId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await InsertOutboxAsync(connection, transaction, organizationId,
            "chat.message_created", id,
            new { id, channelId, channel.ProjectId, authorId }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        var resources = attachments.Length == 0 ? [] :
            (await ListResourcesAsync(organizationId, channel.ProjectId, cancellationToken))!
                .Where(item => attachments.Contains(item.Id)).ToArray();
        return new(id, organizationId, channelId, authorId, authorName, body, now, null,
            resources, mentions);
    }

    private static async Task<bool> ResourcesValidAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid organizationId, Guid projectId, Guid[] ids, CancellationToken cancellationToken)
    {
        if (ids.Length == 0) return true;
        await using var command = new NpgsqlCommand(
            """
            SELECT count(*)=@count FROM project_resources
            WHERE organization_id=@organization AND project_id=@project
              AND id=ANY(@ids) AND status IN ('ready','available');
            """, connection, transaction);
        command.Parameters.AddWithValue("count", ids.Length);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("ids", ids);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task<Guid[]> ValidMentionsAsync(
        NpgsqlConnection connection, NpgsqlTransaction transaction,
        Guid organizationId, Guid[] ids, CancellationToken cancellationToken)
    {
        if (ids.Length == 0) return [];
        await using var command = new NpgsqlCommand(
            """
            SELECT user_id FROM organization_members
            WHERE organization_id=@organization AND user_id=ANY(@ids);
            """, connection, transaction);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("ids", ids);
        var result = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(reader.GetGuid(0));
        return result.ToArray();
    }
}
