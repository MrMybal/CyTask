using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<ProjectResource?> CompleteResourceUploadAsync(
        Guid organizationId, Guid uploadId, string detectedContentType,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        Guid? resourceId = null;
        Guid? projectId = null;
        await using (var command = new NpgsqlCommand(
            """
            UPDATE project_resources r SET status='available',detected_content_type=@content_type,
              revision=revision+1,updated_at=@now
            FROM project_resource_uploads ru
            WHERE ru.id=@upload AND ru.resource_id=r.id AND r.organization_id=@organization
              AND ru.status='active'
            RETURNING r.id,r.project_id;
            """, connection, transaction))
        {
            command.Parameters.AddWithValue("upload", uploadId);
            command.Parameters.AddWithValue("organization", organizationId);
            command.Parameters.AddWithValue("content_type", detectedContentType);
            command.Parameters.AddWithValue("now", DateTimeOffset.UtcNow);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                resourceId = reader.GetGuid(0);
                projectId = reader.GetGuid(1);
            }
        }
        if (resourceId is null) return null;
        await using (var command = new NpgsqlCommand(
            "UPDATE project_resource_uploads SET status='completed' WHERE id=@upload;",
            connection, transaction))
        {
            command.Parameters.AddWithValue("upload", uploadId);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }
        await InsertOutboxAsync(connection, transaction, organizationId,
            "project.resource_available", resourceId.Value,
            new { id = resourceId, projectId }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await GetResourceAsync(organizationId, resourceId.Value, cancellationToken);
    }

    public async Task RejectResourceUploadAsync(
        Guid organizationId, Guid uploadId, string reason, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            """
            UPDATE project_resources r SET status='rejected',rejection_reason=@reason,
              revision=revision+1,updated_at=@now
            FROM project_resource_uploads ru
            WHERE ru.id=@upload AND ru.resource_id=r.id AND r.organization_id=@organization;
            UPDATE project_resource_uploads ru SET status='rejected'
            FROM project_resources r
            WHERE ru.id=@upload AND ru.resource_id=r.id AND r.organization_id=@organization;
            """, connection);
        command.Parameters.AddWithValue("upload", uploadId);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("reason", reason);
        command.Parameters.AddWithValue("now", DateTimeOffset.UtcNow);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
