using Npgsql;

namespace CyTask.Api.Collaboration;

public sealed partial class PostgresCollaborationStore
{
    public async Task<ProjectResourceUpload?> CreateResourceUploadAsync(
        CreateResourceUploadData data, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        if (!await ProjectExistsAsync(connection, transaction, data.OrganizationId, data.ProjectId,
                cancellationToken)
            || !await FolderExistsAsync(connection, transaction, data.OrganizationId, data.ProjectId,
                data.FolderLabelId, cancellationToken)) return null;
        var resourceId = Guid.CreateVersion7();
        var uploadId = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_resources(
              id,organization_id,project_id,folder_label_id,resource_type,name,body,
              declared_content_type,size_bytes,sha256,status,created_by,created_at,updated_at)
            SELECT @resource,@organization,@project,@folder,'file',@name,'',@content_type,
              @size,@sha256,'uploading',@creator,@now,@now
            WHERE EXISTS(SELECT 1 FROM organization_members
              WHERE organization_id=@organization AND user_id=@creator);
            INSERT INTO project_resource_uploads(
              id,resource_id,chunk_size_bytes,status,expires_at,created_at)
            SELECT @upload,@resource,@chunk_size,'active',@expires,@now
            WHERE EXISTS(SELECT 1 FROM project_resources WHERE id=@resource);
            """, connection, transaction);
        command.Parameters.AddWithValue("resource", resourceId);
        command.Parameters.AddWithValue("upload", uploadId);
        command.Parameters.AddWithValue("organization", data.OrganizationId);
        command.Parameters.AddWithValue("project", data.ProjectId);
        AddNullableUuid(command, "folder", data.FolderLabelId);
        command.Parameters.AddWithValue("name", data.FileName);
        command.Parameters.AddWithValue("content_type", data.ContentType);
        command.Parameters.AddWithValue("size", data.SizeBytes);
        command.Parameters.AddWithValue("sha256", data.Sha256);
        command.Parameters.AddWithValue("creator", data.CreatedBy);
        command.Parameters.AddWithValue("chunk_size", data.ChunkSizeBytes);
        command.Parameters.AddWithValue("expires", data.ExpiresAt);
        command.Parameters.AddWithValue("now", now);
        if (await command.ExecuteNonQueryAsync(cancellationToken) != 2) return null;
        await transaction.CommitAsync(cancellationToken);
        return await GetResourceUploadAsync(data.OrganizationId, uploadId, cancellationToken);
    }

    public async Task<ProjectResourceUpload?> GetResourceUploadAsync(
        Guid organizationId, Guid uploadId, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            $"SELECT ru.id,ru.chunk_size_bytes,ru.expires_at,ru.status,{ResourceColumns} " +
            "FROM project_resource_uploads ru JOIN project_resources r ON r.id=ru.resource_id " +
            "JOIN users u ON u.id=r.created_by " +
            "WHERE ru.id=@upload AND r.organization_id=@organization;", connection);
        command.Parameters.AddWithValue("upload", uploadId);
        command.Parameters.AddWithValue("organization", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken)) return null;
        var upload = new ProjectResourceUpload(
            reader.GetGuid(0), ReadResource(reader, 4), reader.GetInt32(1),
            reader.GetFieldValue<DateTimeOffset>(2), reader.GetString(3), []);
        await reader.CloseAsync();
        await using var chunksCommand = new NpgsqlCommand(
            """
            SELECT chunk_index,size_bytes,sha256,created_at
            FROM project_resource_upload_chunks WHERE upload_id=@upload ORDER BY chunk_index;
            """, connection);
        chunksCommand.Parameters.AddWithValue("upload", uploadId);
        await using var chunksReader = await chunksCommand.ExecuteReaderAsync(cancellationToken);
        var chunks = new List<ResourceUploadChunk>();
        while (await chunksReader.ReadAsync(cancellationToken))
            chunks.Add(new(chunksReader.GetInt32(0), chunksReader.GetInt64(1),
                chunksReader.GetString(2), chunksReader.GetFieldValue<DateTimeOffset>(3)));
        return upload with { Chunks = chunks };
    }

    public async Task<ResourceChunkResult> RecordResourceChunkAsync(
        Guid organizationId, Guid uploadId, int index, long sizeBytes, string sha256,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO project_resource_upload_chunks(upload_id,chunk_index,size_bytes,sha256,created_at)
            SELECT ru.id,@index,@size,@sha256,@now
            FROM project_resource_uploads ru JOIN project_resources r ON r.id=ru.resource_id
            WHERE ru.id=@upload AND r.organization_id=@organization
              AND ru.status='active' AND ru.expires_at>@now
            ON CONFLICT (upload_id,chunk_index) DO NOTHING;
            """, connection);
        command.Parameters.AddWithValue("upload", uploadId);
        command.Parameters.AddWithValue("organization", organizationId);
        command.Parameters.AddWithValue("index", index);
        command.Parameters.AddWithValue("size", sizeBytes);
        command.Parameters.AddWithValue("sha256", sha256);
        command.Parameters.AddWithValue("now", now);
        if (await command.ExecuteNonQueryAsync(cancellationToken) == 1)
            return new(ResourceChunkStatus.Recorded, new(index, sizeBytes, sha256, now));
        await using var existingCommand = new NpgsqlCommand(
            """
            SELECT c.size_bytes,c.sha256,c.created_at FROM project_resource_upload_chunks c
            JOIN project_resource_uploads ru ON ru.id=c.upload_id
            JOIN project_resources r ON r.id=ru.resource_id
            WHERE c.upload_id=@upload AND c.chunk_index=@index AND r.organization_id=@organization;
            """, connection);
        existingCommand.Parameters.AddWithValue("upload", uploadId);
        existingCommand.Parameters.AddWithValue("index", index);
        existingCommand.Parameters.AddWithValue("organization", organizationId);
        await using var existingReader = await existingCommand.ExecuteReaderAsync(cancellationToken);
        if (!await existingReader.ReadAsync(cancellationToken))
            return new(ResourceChunkStatus.NotFound, null);
        var existing = new ResourceUploadChunk(index, existingReader.GetInt64(0),
            existingReader.GetString(1), existingReader.GetFieldValue<DateTimeOffset>(2));
        return new(existing.SizeBytes == sizeBytes && existing.Sha256 == sha256
            ? ResourceChunkStatus.AlreadyRecorded : ResourceChunkStatus.Conflict, existing);
    }
}
