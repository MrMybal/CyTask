using CyTask.Api.Domain;
using CyTask.Api.Security;

namespace CyTask.Api.Infrastructure;

public sealed partial class PostgresWorkspaceStore
{
    private async Task<IReadOnlyList<SearchHit>> SearchEncryptedAsync(Guid organizationId, string query, int limit, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT kind,id,item_key,title,description,updated_at FROM (
                SELECT 'project'::text AS kind,id,project_key AS item_key,name AS title,''::text AS description,created_at AS updated_at
                FROM projects WHERE organization_id=@organization
                UNION ALL
                SELECT 'task',t.id,p.project_key || '-' || t.task_number,t.title,t.description,t.updated_at
                FROM tasks t JOIN projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
                WHERE t.organization_id=@organization
            ) AS items ORDER BY updated_at DESC,id;
            """);
        command.Parameters.AddWithValue("organization", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<SearchHit>();
        while (result.Count < limit && await reader.ReadAsync(cancellationToken))
        {
            var key = reader.GetString(2); var title = reader.GetString(0) == "project" ? reader.GetString(3) : encryption.ReadString(reader, 3); var description = encryption.ReadString(reader, 4);
            if (!key.Contains(query, StringComparison.OrdinalIgnoreCase) && !title.Contains(query, StringComparison.OrdinalIgnoreCase)
                && !description.Contains(query, StringComparison.OrdinalIgnoreCase)) continue;
            result.Add(new(reader.GetString(0), reader.GetGuid(1), key, title,
                description[..Math.Min(160, description.Length)], reader.GetFieldValue<DateTimeOffset>(5)));
        }
        return result;
    }

    private async Task<TaskPageSlice?> GetEncryptedTaskPageAsync(Guid organizationId, Guid projectId, TaskPageRequest request, CancellationToken cancellationToken)
    {
        if (!await ProjectExistsAsync(organizationId, projectId, cancellationToken)) return null;
        var metadataRequest = request with { Query = "", Cursor = null };
        await using var command = dataSource.CreateCommand($"""
            SELECT t.id,t.organization_id,t.project_id,t.task_number,p.project_key,t.title,t.description,
                t.status,t.priority,t.due_at,t.assignee_id,au.display_name,t.revision,t.created_by,t.created_at,t.updated_at
            FROM tasks t JOIN projects p ON p.id=t.project_id AND p.organization_id=t.organization_id
            LEFT JOIN users au ON au.id=t.assignee_id
            {BuildTaskPageWhere(metadataRequest, includeCursor: false)};
            """);
        AddTaskPageParameters(command, organizationId, projectId, metadataRequest, includeCursor: false);
        var tasks = new List<WorkItem>();
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            while (await reader.ReadAsync(cancellationToken)) tasks.Add(ReadTask(reader));
        await command.DisposeAsync();
        var populated = await PopulateTaskAssigneesAsync(organizationId, tasks, cancellationToken);
        var matching = populated.Where(task => request.Query.Length == 0
            || task.Title.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || task.Description.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || task.Key.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || (task.AssigneeName?.Contains(request.Query, StringComparison.OrdinalIgnoreCase) ?? false)
            || (task.Assignees?.Any(assignee => assignee.DisplayName.Contains(request.Query, StringComparison.OrdinalIgnoreCase)) ?? false)).ToArray();
        var page = InMemoryWorkspaceStore.OrderTaskPage(matching, request.Sort)
            .Where(task => request.Cursor is null || InMemoryWorkspaceStore.IsAfterTaskCursor(task, request))
            .Take(request.Limit + 1).ToArray();
        return new(page.Take(request.Limit).ToArray(), matching.Length, page.Length > request.Limit);
    }
}
