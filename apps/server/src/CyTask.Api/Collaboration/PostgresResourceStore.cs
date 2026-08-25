using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<IReadOnlyList<ProjectResource>?> ListResourcesAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, null, organizationId, projectId, cancellationToken))
            return null;
        await using var command = new NpgsqlCommand(
            $"SELECT {ResourceColumns} FROM project_resources r JOIN users u ON u.id=r.created_by " +
            "WHERE r.organization_id=@organization AND r.project_id=@project " +
            "ORDER BY r.updated_at DESC,lower(r.name),r.id;", connection);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        return await ReadResourcesAsync(command, cancellationToken);
    }

    public async Task<ProjectResource?> GetResourceAsync(
        Guid organizationId, Guid resourceId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        return await GetResourceCoreAsync(
            connection, null, organizationId, resourceId, cancellationToken);
    }

    public async Task<ProjectResource?> CreateResourceAsync(
        Guid organizationId, Guid projectId, Guid? folderLabelId, string resourceType,
        string name, string body, Guid createdBy, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, transaction, organizationId, projectId, cancellationToken)
            || !await FolderExistsAsync(connection, transaction, organizationId, projectId,
                folderLabelId, cancellationToken)) return null;
        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_resources(
              id,organization_id,project_id,folder_label_id,resource_type,name,body,status,
              created_by,created_at,updated_at)
            SELECT @id,@organization,@project,@folder,@type,@name,@body,'ready',@creator,@now,@now
            WHERE EXISTS(SELECT 1 FROM organization_members
              WHERE organization_id=@organization AND user_id=@creator);
            """, connection, transaction);
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("project", projectId);
        AddNullableUuid(command, "folder", folderLabelId);
        command.Parameters.AddWithValue("type", resourceType);
        command.Parameters.AddWithValue("name", name);
        command.Parameters.AddWithValue("body", body);
        command.Parameters.AddWithValue("creator", createdBy);
        command.Parameters.AddWithValue("now", now);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1) return null;
        await InsertOutboxAsync(connection, transaction, organizationId,
            "project.resource_created", id, new { id, projectId, resourceType, name }, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return await GetResourceAsync(organizationId, id, cancellationToken);
    }

    public async Task<ResourceUpdateResult> UpdateResourceAsync(
        Guid organizationId, Guid resourceId, Guid? folderLabelId, string name, string body,
        long expectedRevision, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var current = await GetResourceCoreAsync(
            connection, transaction, organizationId, resourceId, cancellationToken);
        if (current is null) return new(ResourceUpdateStatus.NotFound, null);
        if (current.Revision != expectedRevision)
            return new(ResourceUpdateStatus.RevisionConflict, current);
        if (!await FolderExistsAsync(connection, transaction, organizationId, current.ProjectId,
                folderLabelId, cancellationToken)) return new(ResourceUpdateStatus.NotFound, null);
        await using var command = new NpgsqlCommand(
            """
            UPDATE project_resources SET folder_label_id=@folder,name=@name,body=@body,
              revision=revision+1,updated_at=@now
            WHERE id=@id AND organization_id=@organization AND revision=@revision;
            """, connection, transaction);
        AddNullableUuid(command, "folder", folderLabelId);
        command.Parameters.AddWithValue("name", name);
        command.Parameters.AddWithValue("body", body);
        command.Parameters.AddWithValue("now", DateTimeOffset.UtcNow);
        command.Parameters.AddWithValue("id", resourceId);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("revision", expectedRevision);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 1)
        {
            var latest = await GetResourceCoreAsync(
                connection, transaction, organizationId, resourceId, cancellationToken);
            return new(ResourceUpdateStatus.RevisionConflict, latest);
        }
        await InsertOutboxAsync(connection, transaction, organizationId,
            "project.resource_updated", resourceId, new { id = resourceId, current.ProjectId },
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new(ResourceUpdateStatus.Updated,
            await GetResourceAsync(organizationId, resourceId, cancellationToken));
    }

    private static async Task<ProjectResource?> GetResourceCoreAsync(
        NpgsqlConnection connection, NpgsqlTransaction? transaction,
        Guid organizationId, Guid resourceId, CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            $"SELECT {ResourceColumns} FROM project_resources r JOIN users u ON u.id=r.created_by " +
            "WHERE r.organization_id=@organization AND r.id=@id;", connection, transaction);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("id", resourceId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadResource(reader) : null;
    }
}
