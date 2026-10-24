using CyTask.Api.Domain;
using Npgsql;

namespace CyTask.Api.Infrastructure;

public sealed partial class PostgresWorkspaceStore
{
    private async Task<IReadOnlyList<WorkItem>> PopulateTaskAssigneesAsync(
        Guid organizationId, List<WorkItem> tasks, CancellationToken cancellationToken,
        NpgsqlConnection? connection = null, NpgsqlTransaction? transaction = null)
    {
        if (tasks.Count == 0) return tasks;
        const string sql = """
            SELECT assignment.task_id, assignment.user_id, member.display_name
            FROM task_assignees assignment
            JOIN users member ON member.id = assignment.user_id
            WHERE assignment.organization_id = @organization_id
              AND assignment.task_id = ANY(@task_ids)
            ORDER BY assignment.task_id, assignment.assigned_at, assignment.user_id;
            """;
        await using var command = connection is null
            ? dataSource.CreateCommand(sql) : new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_ids", tasks.Select(task => task.Id).ToArray());
        var assignees = new Dictionary<Guid, List<TaskAssignee>>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var taskId = reader.GetGuid(0);
            if (!assignees.TryGetValue(taskId, out var members)) assignees[taskId] = members = [];
            members.Add(new(reader.GetGuid(1), reader.GetString(2)));
        }
        return tasks.Select(task => task with
        {
            Assignees = assignees.TryGetValue(task.Id, out var members) ? members : []
        }).ToArray();
    }
}
