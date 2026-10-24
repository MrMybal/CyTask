using CyTask.Api.Domain;

namespace CyTask.Api.Infrastructure;

public sealed partial class InMemoryWorkspaceStore
{
    private readonly Dictionary<Guid, AgentMember> _agents = [];
    private readonly Dictionary<Guid, AgentNotification> _agentNotifications = [];

    public Task<UserAccount?> FindLocalOwnerAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var owner = _memberships.Values
                .Where(item => item.Role == "owner")
                .OrderBy(item => _users[item.UserId].CreatedAt)
                .FirstOrDefault();
            return Task.FromResult(owner == default ? null : _users.GetValueOrDefault(owner.UserId));
        }
    }

    public Task<CreatedAgentMember?> CreateAgentAsync(
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
        lock (_gate)
        {
            if (!_memberships.TryGetValue(createdBy, out var actor)
                || actor.OrganizationId != organizationId
                || actor.Role is not ("owner" or "admin")
                || _agents.Values.Any(item => item.OrganizationId == organizationId && item.Key == key))
            {
                return Task.FromResult<CreatedAgentMember?>(null);
            }

            var now = DateTimeOffset.UtcNow;
            var userId = Guid.CreateVersion7();
            var user = new UserAccount(
                userId,
                $"agent-{userId:N}@agents.cytask.invalid",
                displayName,
                passwordHash,
                now);
            var agent = new AgentMember(
                userId,
                organizationId,
                key,
                displayName,
                description,
                capabilities.Distinct(StringComparer.Ordinal).Order().ToArray(),
                "active",
                createdBy,
                now,
                null,
                1);
            var token = new ApiToken(
                Guid.CreateVersion7(), $"Agent {key}", "read write", now, null, null, null);

            _users.Add(userId, user);
            _memberships.Add(userId, (userId, organizationId, "member"));
            _agents.Add(userId, agent);
            _apiTokens.Add(
                Convert.ToHexString(apiTokenHash),
                new ApiTokenEntry(token, organizationId, userId));
            PersistLocalSessionsUnderLock();
            AddActivity(
                organizationId, "agent.created", "agent", userId,
                createdBy, _users[createdBy].DisplayName, $"Agent {displayName} créé", now);
            return Task.FromResult<CreatedAgentMember?>(new(agent, apiToken));
        }
    }

    public Task<IReadOnlyList<AgentMember>> ListAgentsAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<AgentMember> result = _agents.Values
                .Where(item => item.OrganizationId == organizationId)
                .OrderBy(item => item.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<AgentMember?> FindAgentAsync(
        Guid organizationId,
        Guid agentUserId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            return Task.FromResult(
                _agents.TryGetValue(agentUserId, out var agent) && agent.OrganizationId == organizationId
                    ? agent
                    : null);
        }
    }

    public Task<AgentMember?> UpdateAgentStatusAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid updatedBy,
        string status,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(updatedBy, out var actor)
                || actor.OrganizationId != organizationId
                || actor.Role is not ("owner" or "admin")
                || !_agents.TryGetValue(agentUserId, out var agent)
                || agent.OrganizationId != organizationId)
            {
                return Task.FromResult<AgentMember?>(null);
            }

            var updated = agent with { Status = status, Revision = agent.Revision + 1 };
            _agents[agentUserId] = updated;
            AddActivity(
                organizationId, "agent.status_updated", "agent", agentUserId,
                updatedBy, _users[updatedBy].DisplayName,
                $"Agent {agent.DisplayName} passé à l’état {status}", DateTimeOffset.UtcNow);
            return Task.FromResult<AgentMember?>(updated);
        }
    }

    public Task<AgentContext?> GetAgentContextAsync(
        Guid organizationId,
        Guid agentUserId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_agents.TryGetValue(agentUserId, out var agent)
                || agent.OrganizationId != organizationId
                || agent.Status != "active")
            {
                return Task.FromResult<AgentContext?>(null);
            }

            var touched = agent with { LastSeenAt = DateTimeOffset.UtcNow };
            _agents[agentUserId] = touched;
            IReadOnlyList<Project> projects = _projects.Values
                .Where(item => item.OrganizationId == organizationId)
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            IReadOnlyList<WorkItem> tasks = _tasks.Values
                .Where(item => item.OrganizationId == organizationId
                    && (item.Assignees ?? []).Any(assignee => assignee.UserId == agentUserId))
                .OrderByDescending(item => item.UpdatedAt)
                .ToArray();
            IReadOnlyList<AgentNotification> notifications = _agentNotifications.Values
                .Where(item => item.OrganizationId == organizationId
                    && item.AgentUserId == agentUserId
                    && item.AcknowledgedAt is null)
                .OrderBy(item => item.CreatedAt)
                .ToArray();
            return Task.FromResult<AgentContext?>(new(touched, projects, tasks, notifications));
        }
    }

    public Task<ClaimAgentTaskResult> ClaimTaskForAgentAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_agents.TryGetValue(agentUserId, out var agent)
                || agent.OrganizationId != organizationId
                || agent.Status != "active")
            {
                return Task.FromResult(new ClaimAgentTaskResult(
                    ClaimAgentTaskStatus.AgentUnavailable, null));
            }
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult(new ClaimAgentTaskResult(ClaimAgentTaskStatus.NotFound, null));
            }

            var current = task.Assignees ?? [];
            if (current.Any(item => item.UserId == agentUserId))
            {
                return Task.FromResult(new ClaimAgentTaskResult(
                    ClaimAgentTaskStatus.AlreadyClaimed, task));
            }
            if (current.Count > 0)
            {
                return Task.FromResult(new ClaimAgentTaskResult(
                    ClaimAgentTaskStatus.AssignedToAnotherMember, task));
            }

            var assignee = new TaskAssignee(agentUserId, agent.DisplayName);
            var now = DateTimeOffset.UtcNow;
            var updated = task with
            {
                AssigneeId = agentUserId,
                AssigneeName = agent.DisplayName,
                Assignees = [assignee],
                Revision = task.Revision + 1,
                UpdatedAt = now
            };
            _tasks[taskId] = updated;
            _agents[agentUserId] = agent with { LastSeenAt = now };
            AddActivity(
                organizationId, "task.claimed", "task", taskId,
                agentUserId, agent.DisplayName, $"{agent.DisplayName} a pris {task.Key}", now);
            return Task.FromResult(new ClaimAgentTaskResult(ClaimAgentTaskStatus.Claimed, updated));
        }
    }

    public Task<AgentNotification?> CreateAgentNotificationAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid createdBy,
        string type,
        string title,
        string body,
        Guid? taskId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(createdBy, out var actor)
                || actor.OrganizationId != organizationId
                || actor.Role == "viewer"
                || !_agents.TryGetValue(agentUserId, out var agent)
                || agent.OrganizationId != organizationId
                || taskId is Guid linkedTaskId
                    && (!_tasks.TryGetValue(linkedTaskId, out var task) || task.OrganizationId != organizationId))
            {
                return Task.FromResult<AgentNotification?>(null);
            }

            var notification = new AgentNotification(
                Guid.CreateVersion7(), organizationId, agentUserId, createdBy,
                type, title, body, taskId, 1, DateTimeOffset.UtcNow, null);
            _agentNotifications.Add(notification.Id, notification);
            AddActivity(
                organizationId, "agent.called", "agent", agentUserId,
                createdBy, _users[createdBy].DisplayName, $"Appel envoyé à {agent.DisplayName}",
                notification.CreatedAt);
            return Task.FromResult<AgentNotification?>(notification);
        }
    }

    public Task<IReadOnlyList<AgentNotification>> ListAgentNotificationsAsync(
        Guid organizationId,
        Guid agentUserId,
        bool includeAcknowledged,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<AgentNotification> result = _agentNotifications.Values
                .Where(item => item.OrganizationId == organizationId
                    && item.AgentUserId == agentUserId
                    && (includeAcknowledged || item.AcknowledgedAt is null))
                .OrderBy(item => item.CreatedAt)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<AgentNotification?> AcknowledgeAgentNotificationAsync(
        Guid organizationId,
        Guid agentUserId,
        Guid notificationId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_agentNotifications.TryGetValue(notificationId, out var notification)
                || notification.OrganizationId != organizationId
                || notification.AgentUserId != agentUserId)
            {
                return Task.FromResult<AgentNotification?>(null);
            }

            if (notification.AcknowledgedAt is not null)
            {
                return Task.FromResult<AgentNotification?>(notification);
            }
            var updated = notification with
            {
                Revision = notification.Revision + 1,
                AcknowledgedAt = DateTimeOffset.UtcNow
            };
            _agentNotifications[notificationId] = updated;
            _localState.Changed();
            return Task.FromResult<AgentNotification?>(updated);
        }
    }
}
