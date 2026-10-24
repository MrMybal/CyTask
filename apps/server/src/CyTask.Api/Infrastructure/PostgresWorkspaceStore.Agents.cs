using CyTask.Api.Domain;
using Npgsql;

namespace CyTask.Api.Infrastructure;

public sealed partial class PostgresWorkspaceStore
{
    public async Task<UserAccount?> FindLocalOwnerAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT u.id, u.normalized_email, u.display_name, u.password_hash, u.created_at
            FROM organization_members membership
            JOIN users u ON u.id = membership.user_id
            WHERE membership.role = 'owner'
            ORDER BY membership.created_at, u.id
            LIMIT 1;
            """);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<CreatedAgentMember?> CreateAgentAsync(
        Guid organizationId,
        Guid createdBy,
        string key,
        string displayName,
        string description,
        IReadOnlyList<string> capabilities,
        string passwordHash,
        string apiToken,
        byte[] apiTokenHash,
        int maximumActiveTokens,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        var userId = Guid.CreateVersion7();
        var agent = new AgentMember(
            userId, organizationId, key, displayName, description,
            capabilities.Distinct(StringComparer.Ordinal).Order().ToArray(),
            "active", createdBy, now, null, 1);
        var token = new ApiToken(
            Guid.CreateVersion7(), $"Agent {key}", "read write", now, null, null, null);

        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await using (var roleCommand = new NpgsqlCommand("""
                             SELECT role
                             FROM organization_members
                             WHERE organization_id = @organization_id AND user_id = @created_by;
                             """, connection, transaction))
            {
                roleCommand.Parameters.AddWithValue("organization_id", organizationId);
                roleCommand.Parameters.AddWithValue("created_by", createdBy);
                var role = (string?)await roleCommand.ExecuteScalarAsync(cancellationToken);
                if (role is not ("owner" or "admin"))
                {
                    await transaction.RollbackAsync(cancellationToken);
                    return null;
                }
            }

            await ExecuteAsync(connection, transaction, """
                INSERT INTO users(id, normalized_email, display_name, password_hash, created_at)
                VALUES (@id, @email, @display_name, @password_hash, @created_at);
                """, cancellationToken,
                ("id", userId), ("email", $"agent-{userId:N}@agents.cytask.invalid"),
                ("display_name", displayName), ("password_hash", passwordHash), ("created_at", now));
            await ExecuteAsync(connection, transaction, """
                INSERT INTO organization_members(organization_id, user_id, role, created_at)
                VALUES (@organization_id, @user_id, 'member', @created_at);
                """, cancellationToken,
                ("organization_id", organizationId), ("user_id", userId), ("created_at", now));
            await ExecuteAsync(connection, transaction, """
                INSERT INTO agent_members(
                    organization_id, user_id, agent_key, description, capabilities, status,
                    created_by, created_at, revision)
                VALUES (
                    @organization_id, @user_id, @agent_key, @description, @capabilities,
                    'active', @created_by, @created_at, 1);
                """, cancellationToken,
                ("organization_id", organizationId), ("user_id", userId), ("agent_key", key),
                ("description", description), ("capabilities", agent.Capabilities.ToArray()),
                ("created_by", createdBy), ("created_at", now));
            await ExecuteAsync(connection, transaction, """
                INSERT INTO api_tokens(
                    id, organization_id, user_id, name, token_hash, scopes,
                    created_at, expires_at, last_used_at, revoked_at)
                VALUES (
                    @id, @organization_id, @user_id, @name, @token_hash, 'read write',
                    @created_at, NULL, NULL, NULL);
                """, cancellationToken,
                ("id", token.Id), ("organization_id", organizationId), ("user_id", userId),
                ("name", token.Name), ("token_hash", apiTokenHash), ("created_at", now));
            await InsertOutboxAsync(
                connection, transaction, organizationId, "agent.created", userId, agent, cancellationToken);
            await InsertAuditAsync(
                connection, transaction, organizationId, "agent.created", "agent", userId,
                createdBy, await GetDisplayNameAsync(connection, transaction, createdBy, cancellationToken),
                $"Agent {displayName} créé", now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new CreatedAgentMember(agent, apiToken);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<AgentMember>> ListAgentsAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(AgentSelect + """
            WHERE agent.organization_id = @organization_id
            ORDER BY lower(member.display_name), agent.user_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<AgentMember>();
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadAgent(reader));
        return result;
    }

    public async Task<AgentMember?> FindAgentAsync(
        Guid organizationId,
        Guid agentUserId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(AgentSelect + """
            WHERE agent.organization_id = @organization_id AND agent.user_id = @user_id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("user_id", agentUserId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAgent(reader) : null;
    }

    public async Task<AgentMember?> UpdateAgentStatusAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid updatedBy,
        string status,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        AgentMember? updated;
        await using (var command = new NpgsqlCommand("""
                         UPDATE agent_members agent
                         SET status = @status, revision = revision + 1
                         FROM users member
                         WHERE agent.organization_id = @organization_id
                           AND agent.user_id = @agent_user_id
                           AND member.id = agent.user_id
                           AND EXISTS (
                               SELECT 1 FROM organization_members actor
                               WHERE actor.organization_id = @organization_id
                                 AND actor.user_id = @updated_by
                                 AND actor.role IN ('owner', 'admin')
                           )
                         RETURNING agent.user_id, agent.organization_id, agent.agent_key,
                                   member.display_name, agent.description, agent.capabilities,
                                   agent.status, agent.created_by, agent.created_at,
                                   agent.last_seen_at, agent.revision;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("status", status);
            command.Parameters.AddWithValue("organization_id", organizationId);
            command.Parameters.AddWithValue("agent_user_id", agentUserId);
            command.Parameters.AddWithValue("updated_by", updatedBy);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            updated = await reader.ReadAsync(cancellationToken) ? ReadAgent(reader) : null;
        }
        if (updated is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }
        await InsertOutboxAsync(
            connection, transaction, organizationId, "agent.status_updated", agentUserId,
            updated, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "agent.status_updated", "agent", agentUserId,
            updatedBy, await GetDisplayNameAsync(connection, transaction, updatedBy, cancellationToken),
            $"Agent {updated.DisplayName} passé à l’état {status}", DateTimeOffset.UtcNow,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return updated;
    }

    public async Task<AgentContext?> GetAgentContextAsync(
        Guid organizationId,
        Guid agentUserId,
        CancellationToken cancellationToken)
    {
        await using (var touch = dataSource.CreateCommand("""
                         UPDATE agent_members
                         SET last_seen_at = now()
                         WHERE organization_id = @organization_id AND user_id = @user_id
                           AND status = 'active';
                         """))
        {
            touch.Parameters.AddWithValue("organization_id", organizationId);
            touch.Parameters.AddWithValue("user_id", agentUserId);
            if (await touch.ExecuteNonQueryAsync(cancellationToken) == 0) return null;
        }
        var agent = await FindAgentAsync(organizationId, agentUserId, cancellationToken);
        if (agent is null) return null;
        var projects = await ListProjectsAsync(organizationId, cancellationToken);
        var tasks = new List<WorkItem>();
        await using (var command = dataSource.CreateCommand("""
                         SELECT task.id, task.organization_id, task.project_id, task.task_number,
                                project.project_key, task.title, task.description, task.status,
                                task.priority, task.due_at, task.assignee_id, primary_user.display_name,
                                task.revision, task.created_by, task.created_at, task.updated_at
                         FROM task_assignees assignment
                         JOIN tasks task ON task.id = assignment.task_id
                           AND task.organization_id = assignment.organization_id
                         JOIN projects project ON project.id = task.project_id
                         LEFT JOIN users primary_user ON primary_user.id = task.assignee_id
                         WHERE assignment.organization_id = @organization_id
                           AND assignment.user_id = @user_id
                         ORDER BY task.updated_at DESC, task.id;
                         """))
        {
            command.Parameters.AddWithValue("organization_id", organizationId);
            command.Parameters.AddWithValue("user_id", agentUserId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) tasks.Add(ReadTask(reader));
        }
        var notifications = await ListAgentNotificationsAsync(
            organizationId, agentUserId, false, cancellationToken);
        return new AgentContext(agent, projects,
            await PopulateTaskAssigneesAsync(organizationId, tasks, cancellationToken), notifications);
    }

    public async Task<ClaimAgentTaskResult> ClaimTaskForAgentAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var agent = await ReadAgentAsync(
            connection, transaction, organizationId, agentUserId, true, cancellationToken);
        if (agent is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return new ClaimAgentTaskResult(ClaimAgentTaskStatus.AgentUnavailable, null);
        }

        WorkItem? task;
        await using (var command = new NpgsqlCommand("""
                         SELECT task.id, task.organization_id, task.project_id, task.task_number,
                                project.project_key, task.title, task.description, task.status,
                                task.priority, task.due_at, task.assignee_id, primary_user.display_name,
                                task.revision, task.created_by, task.created_at, task.updated_at
                         FROM tasks task
                         JOIN projects project ON project.id = task.project_id
                         LEFT JOIN users primary_user ON primary_user.id = task.assignee_id
                         WHERE task.organization_id = @organization_id AND task.id = @task_id
                         FOR UPDATE OF task;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("organization_id", organizationId);
            command.Parameters.AddWithValue("task_id", taskId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            task = await reader.ReadAsync(cancellationToken) ? ReadTask(reader) : null;
        }
        if (task is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return new ClaimAgentTaskResult(ClaimAgentTaskStatus.NotFound, null);
        }

        var current = await ReadTaskAssigneesAsync(
            connection, transaction, organizationId, taskId, cancellationToken);
        if (current.Any(item => item.UserId == agentUserId))
        {
            await transaction.RollbackAsync(cancellationToken);
            return new ClaimAgentTaskResult(
                ClaimAgentTaskStatus.AlreadyClaimed, task with { Assignees = current });
        }
        if (current.Count > 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return new ClaimAgentTaskResult(
                ClaimAgentTaskStatus.AssignedToAnotherMember, task with { Assignees = current });
        }

        var now = DateTimeOffset.UtcNow;
        await ExecuteAsync(connection, transaction, """
            INSERT INTO task_assignees(organization_id, task_id, user_id, assigned_at)
            VALUES (@organization_id, @task_id, @user_id, @assigned_at);
            """, cancellationToken,
            ("organization_id", organizationId), ("task_id", taskId),
            ("user_id", agentUserId), ("assigned_at", now));
        await ExecuteAsync(connection, transaction, """
            UPDATE tasks
            SET assignee_id = @user_id, revision = revision + 1, updated_at = @updated_at
            WHERE organization_id = @organization_id AND id = @task_id;
            UPDATE agent_members SET last_seen_at = @updated_at
            WHERE organization_id = @organization_id AND user_id = @user_id;
            """, cancellationToken,
            ("user_id", agentUserId), ("updated_at", now),
            ("organization_id", organizationId), ("task_id", taskId));
        var updated = task with
        {
            AssigneeId = agentUserId,
            AssigneeName = agent.DisplayName,
            Assignees = [new TaskAssignee(agentUserId, agent.DisplayName)],
            Revision = task.Revision + 1,
            UpdatedAt = now
        };
        await InsertOutboxAsync(
            connection, transaction, organizationId, "task.claimed", taskId, updated, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "task.claimed", "task", taskId,
            agentUserId, agent.DisplayName, $"{agent.DisplayName} a pris {task.Key}", now,
            cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new ClaimAgentTaskResult(ClaimAgentTaskStatus.Claimed, updated);
    }

    public async Task<AgentNotification?> CreateAgentNotificationAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid createdBy,
        string type,
        string title,
        string body,
        Guid? taskId,
        CancellationToken cancellationToken)
    {
        var notification = new AgentNotification(
            Guid.CreateVersion7(), organizationId, agentUserId, createdBy,
            type, title, body, taskId, 1, DateTimeOffset.UtcNow, null);
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var affected = await ExecuteAsync(connection, transaction, """
            INSERT INTO agent_notifications(
                id, organization_id, agent_user_id, created_by, notification_type,
                title, body, task_id, revision, created_at)
            SELECT @id, @organization_id, @agent_user_id, @created_by, @notification_type,
                   @title, @body, @task_id, 1, @created_at
            WHERE EXISTS (
                SELECT 1 FROM agent_members
                WHERE organization_id = @organization_id AND user_id = @agent_user_id
                  AND status <> 'disabled'
            ) AND EXISTS (
                SELECT 1 FROM organization_members
                WHERE organization_id = @organization_id AND user_id = @created_by
                  AND role IN ('owner', 'admin', 'member')
            ) AND (
                @task_id IS NULL OR EXISTS (
                    SELECT 1 FROM tasks
                    WHERE organization_id = @organization_id AND id = @task_id
                )
            );
            """, cancellationToken,
            ("id", notification.Id), ("organization_id", organizationId),
            ("agent_user_id", agentUserId), ("created_by", createdBy),
            ("notification_type", type), ("title", title), ("body", body),
            ("task_id", (object?)taskId ?? DBNull.Value), ("created_at", notification.CreatedAt));
        if (affected == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }
        await InsertOutboxAsync(
            connection, transaction, organizationId, "agent.called", notification.Id,
            notification, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "agent.called", "agent", agentUserId,
            createdBy, await GetDisplayNameAsync(connection, transaction, createdBy, cancellationToken),
            $"Appel envoyé à un agent : {title}", notification.CreatedAt, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return notification;
    }

    public async Task<IReadOnlyList<AgentNotification>> ListAgentNotificationsAsync(
        Guid organizationId,
        Guid agentUserId,
        bool includeAcknowledged,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand(NotificationSelect + """
            WHERE notification.organization_id = @organization_id
              AND notification.agent_user_id = @agent_user_id
              AND (@include_acknowledged OR notification.acknowledged_at IS NULL)
            ORDER BY notification.created_at, notification.id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("agent_user_id", agentUserId);
        command.Parameters.AddWithValue("include_acknowledged", includeAcknowledged);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<AgentNotification>();
        while (await reader.ReadAsync(cancellationToken)) result.Add(ReadAgentNotification(reader));
        return result;
    }

    public async Task<AgentNotification?> AcknowledgeAgentNotificationAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid notificationId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE agent_notifications
            SET acknowledged_at = COALESCE(acknowledged_at, now()),
                revision = CASE WHEN acknowledged_at IS NULL THEN revision + 1 ELSE revision END
            WHERE id = @id AND organization_id = @organization_id
              AND agent_user_id = @agent_user_id
            RETURNING id, organization_id, agent_user_id, created_by, notification_type,
                      title, body, task_id, revision, created_at, acknowledged_at;
            """);
        command.Parameters.AddWithValue("id", notificationId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("agent_user_id", agentUserId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAgentNotification(reader) : null;
    }

    private static async Task<AgentMember?> ReadAgentAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid organizationId,
        Guid agentUserId,
        bool activeOnly,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(AgentSelect + """
            WHERE agent.organization_id = @organization_id AND agent.user_id = @user_id
              AND (NOT @active_only OR agent.status = 'active');
            """, connection, transaction);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("user_id", agentUserId);
        command.Parameters.AddWithValue("active_only", activeOnly);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAgent(reader) : null;
    }

    private const string AgentSelect = """
        SELECT agent.user_id, agent.organization_id, agent.agent_key, member.display_name,
               agent.description, agent.capabilities, agent.status, agent.created_by,
               agent.created_at, agent.last_seen_at, agent.revision
        FROM agent_members agent
        JOIN users member ON member.id = agent.user_id
        """;

    private const string NotificationSelect = """
        SELECT notification.id, notification.organization_id, notification.agent_user_id,
               notification.created_by, notification.notification_type, notification.title,
               notification.body, notification.task_id, notification.revision,
               notification.created_at, notification.acknowledged_at
        FROM agent_notifications notification
        """;

    private static AgentMember ReadAgent(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
        reader.GetString(4), reader.GetFieldValue<string[]>(5), reader.GetString(6),
        reader.GetGuid(7), reader.GetFieldValue<DateTimeOffset>(8),
        reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9), reader.GetInt64(10));

    private static AgentNotification ReadAgentNotification(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
        reader.GetString(4), reader.GetString(5), reader.GetString(6),
        reader.IsDBNull(7) ? null : reader.GetGuid(7), reader.GetInt64(8),
        reader.GetFieldValue<DateTimeOffset>(9),
        reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10));
}
