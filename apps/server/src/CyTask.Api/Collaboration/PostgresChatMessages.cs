using Npgsql;
using NpgsqlTypes;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<IReadOnlyList<ChatMessage>?> ListMessagesAsync(
        Guid organizationId, Guid channelId, int limit, DateTimeOffset? before,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        if (await GetChannelCoreAsync(connection, null, organizationId, channelId,
                cancellationToken) is null) return null;
        await using var command = new NpgsqlCommand(
            """
            SELECT m.id,m.organization_id,m.channel_id,m.author_id,u.display_name,
              m.body,m.created_at,m.edited_at
            FROM chat_messages m JOIN users u ON u.id=m.author_id
            WHERE m.organization_id=@organization AND m.channel_id=@channel
              AND (@before IS NULL OR m.created_at<@before)
            ORDER BY m.created_at DESC,m.id DESC LIMIT @limit;
            """, connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("channel", channelId);
        command.Parameters.Add("before", NpgsqlDbType.TimestampTz).Value =
            before is null ? DBNull.Value : before.Value;
        command.Parameters.AddWithValue("limit", limit);
        var rows = new List<(Guid Id, Guid OrganizationId, Guid ChannelId, Guid AuthorId,
            string AuthorName, string Body, DateTimeOffset CreatedAt, DateTimeOffset? EditedAt)>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            while (await reader.ReadAsync(cancellationToken))
                rows.Add((reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2),
                    reader.GetGuid(3), reader.GetString(4), reader.GetString(5),
                    reader.GetFieldValue<DateTimeOffset>(6),
                    reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7)));
        }
        rows.Reverse();
        var result = new List<ChatMessage>();
        foreach (var row in rows)
            result.Add(new(row.Id, row.OrganizationId, row.ChannelId, row.AuthorId,
                row.AuthorName, row.Body, row.CreatedAt, row.EditedAt,
                await MessageResourcesAsync(connection, row.Id, cancellationToken),
                await MessageMentionsAsync(connection, row.Id, cancellationToken)));
        return result;
    }

    private static async Task<IReadOnlyList<ProjectResource>> MessageResourcesAsync(
        NpgsqlConnection connection, Guid messageId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            $"SELECT {ResourceColumns} FROM chat_message_resources mr " +
            "JOIN project_resources r ON r.id=mr.resource_id JOIN users u ON u.id=r.created_by " +
            "WHERE mr.message_id=@message ORDER BY lower(r.name),r.id;", connection);
        command.Parameters.AddWithValue("message", messageId);
        return await ReadResourcesAsync(command, cancellationToken);
    }

    private static async Task<IReadOnlyList<Guid>> MessageMentionsAsync(
        NpgsqlConnection connection, Guid messageId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT user_id FROM chat_mentions WHERE message_id=@message ORDER BY user_id;",
            connection);
        command.Parameters.AddWithValue("message", messageId);
        var result = new List<Guid>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken)) result.Add(reader.GetGuid(0));
        return result;
    }
}
