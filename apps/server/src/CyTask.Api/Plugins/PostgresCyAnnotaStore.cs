using System.Text.Json;
using Npgsql;

namespace CyTask.Api.Plugins;

public sealed class PostgresCyAnnotaStore(NpgsqlDataSource dataSource) : ICyAnnotaStore
{
    public async Task<IReadOnlyList<CyAnnotaDocument>> ListTaskDocumentsAsync(
        Guid organizationId, Guid taskId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT organization_id, project_id, task_id, attachment_id, media_kind,
                   document::text, annotation_count, revision, updated_by, updated_at
            FROM cyannota_documents
            WHERE organization_id = @organization_id AND task_id = @task_id
            ORDER BY updated_at DESC, attachment_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<CyAnnotaDocument>();
        while (await reader.ReadAsync(cancellationToken)) result.Add(Read(reader));
        return result;
    }

    public async Task<CyAnnotaDocument?> GetDocumentAsync(
        Guid organizationId, Guid taskId, Guid attachmentId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT organization_id, project_id, task_id, attachment_id, media_kind,
                   document::text, annotation_count, revision, updated_by, updated_at
            FROM cyannota_documents
            WHERE organization_id = @organization_id
              AND task_id = @task_id
              AND attachment_id = @attachment_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("attachment_id", attachmentId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task<CyAnnotaDocument?> UpsertDocumentAsync(
        Guid organizationId, Guid projectId, Guid taskId, Guid attachmentId,
        string mediaKind, JsonElement document, int annotationCount,
        long expectedRevision, Guid userId, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            INSERT INTO cyannota_documents(
                organization_id, project_id, task_id, attachment_id, media_kind,
                document, annotation_count, revision, updated_by, updated_at)
            SELECT @organization_id, @project_id, @task_id, @attachment_id, @media_kind,
                   @document::jsonb, @annotation_count, 1, @updated_by, now()
            WHERE @expected_revision = 0
            ON CONFLICT (attachment_id) DO UPDATE
            SET media_kind = EXCLUDED.media_kind,
                document = EXCLUDED.document,
                annotation_count = EXCLUDED.annotation_count,
                revision = cyannota_documents.revision + 1,
                updated_by = EXCLUDED.updated_by,
                updated_at = now()
            WHERE cyannota_documents.organization_id = @organization_id
              AND cyannota_documents.project_id = @project_id
              AND cyannota_documents.task_id = @task_id
              AND cyannota_documents.revision = @expected_revision
            RETURNING organization_id, project_id, task_id, attachment_id, media_kind,
                      document::text, annotation_count, revision, updated_by, updated_at;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("attachment_id", attachmentId);
        command.Parameters.AddWithValue("media_kind", mediaKind);
        command.Parameters.AddWithValue("document", document.GetRawText());
        command.Parameters.AddWithValue("annotation_count", annotationCount);
        command.Parameters.AddWithValue("expected_revision", expectedRevision);
        command.Parameters.AddWithValue("updated_by", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    private static CyAnnotaDocument Read(NpgsqlDataReader reader)
    {
        using var json = JsonDocument.Parse(reader.GetString(5));
        return new(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
            reader.GetString(4), json.RootElement.Clone(), reader.GetInt32(6),
            reader.GetInt64(7), reader.GetGuid(8), reader.GetFieldValue<DateTimeOffset>(9));
    }
}
