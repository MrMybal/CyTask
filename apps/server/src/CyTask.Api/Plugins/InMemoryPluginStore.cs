using System.Text.Json;

namespace CyTask.Api.Plugins;

public sealed class InMemoryPluginStore : IPluginStore
{
    private readonly Lock _gate = new();
    private readonly Dictionary<(Guid ProjectId, string PluginId), ProjectPluginState> _projects = [];
    private readonly Dictionary<(Guid TaskId, string PluginId), TaskPluginData> _tasks = [];
    private readonly Dictionary<(Guid TaskId, string PluginId), List<TaskPluginData>> _history = [];
    private readonly Dictionary<Guid, AiProviderConnection> _aiConnections = [];

    public Task<IReadOnlyList<ProjectPluginState>> ListProjectPluginsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<ProjectPluginState> result = _projects.Values
                .Where(plugin => plugin.OrganizationId == organizationId && plugin.ProjectId == projectId)
                .OrderBy(plugin => plugin.PluginId, StringComparer.Ordinal).ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<ProjectPluginState> EnableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId, Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = (projectId, pluginId);
            if (_projects.TryGetValue(key, out var current) && current.OrganizationId == organizationId)
                return Task.FromResult(current);
            var state = new ProjectPluginState(
                organizationId, projectId, pluginId, true, userId, DateTimeOffset.UtcNow);
            _projects[key] = state;
            return Task.FromResult(state);
        }
    }

    public Task<bool> DisableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = (projectId, pluginId);
            return Task.FromResult(_projects.TryGetValue(key, out var current)
                && current.OrganizationId == organizationId && _projects.Remove(key));
        }
    }

    public Task<TaskPluginData?> GetTaskPluginDataAsync(
        Guid organizationId, Guid taskId, string pluginId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var result = _tasks.GetValueOrDefault((taskId, pluginId));
            return Task.FromResult(result?.OrganizationId == organizationId ? result : null);
        }
    }

    public Task<IReadOnlyList<TaskPluginData>> ListTaskPluginDataHistoryAsync(
        Guid organizationId, Guid taskId, string pluginId, int limit,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<TaskPluginData> result = _history
                .GetValueOrDefault((taskId, pluginId), [])
                .Where(item => item.OrganizationId == organizationId)
                .OrderByDescending(item => item.Revision)
                .Take(Math.Clamp(limit, 1, 100)).ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<TaskPluginData?> UpsertTaskPluginDataAsync(
        Guid organizationId, Guid projectId, Guid taskId, string pluginId,
        JsonElement data, long expectedRevision, Guid userId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = (taskId, pluginId);
            var current = _tasks.GetValueOrDefault(key);
            if ((current is null && expectedRevision != 0)
                || (current is not null && (current.OrganizationId != organizationId
                    || current.ProjectId != projectId || current.Revision != expectedRevision)))
                return Task.FromResult<TaskPluginData?>(null);

            var next = new TaskPluginData(
                organizationId, projectId, taskId, pluginId, data.Clone(),
                (current?.Revision ?? 0) + 1, userId, DateTimeOffset.UtcNow);
            _tasks[key] = next;
            if (!_history.TryGetValue(key, out var history))
            {
                history = [];
                _history[key] = history;
            }
            history.Add(next);
            return Task.FromResult<TaskPluginData?>(next);
        }
    }

    public Task<IReadOnlyList<AiProviderConnection>> ListAiProviderConnectionsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<AiProviderConnection> result = _aiConnections.Values
                .Where(item => item.OrganizationId == organizationId && item.ProjectId == projectId)
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase).ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<AiProviderConnection?> GetAiProviderConnectionAsync(
        Guid organizationId, Guid projectId, Guid connectionId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var item = _aiConnections.GetValueOrDefault(connectionId);
            return Task.FromResult(item?.OrganizationId == organizationId
                && item.ProjectId == projectId ? item : null);
        }
    }

    public Task<AiProviderConnection> CreateAiProviderConnectionAsync(
        AiProviderConnection connection, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            _aiConnections.Add(connection.Id, connection);
            return Task.FromResult(connection);
        }
    }

    public Task<AiProviderConnection?> UpdateAiProviderConnectionAsync(
        AiProviderConnection connection, long expectedRevision, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var current = _aiConnections.GetValueOrDefault(connection.Id);
            if (current is null || current.OrganizationId != connection.OrganizationId
                || current.ProjectId != connection.ProjectId || current.Revision != expectedRevision)
                return Task.FromResult<AiProviderConnection?>(null);

            var updated = connection with
            {
                Revision = current.Revision + 1,
                CreatedBy = current.CreatedBy,
                CreatedAt = current.CreatedAt,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            _aiConnections[connection.Id] = updated;
            return Task.FromResult<AiProviderConnection?>(updated);
        }
    }

    public Task<bool> DeleteAiProviderConnectionAsync(
        Guid organizationId, Guid projectId, Guid connectionId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var item = _aiConnections.GetValueOrDefault(connectionId);
            return Task.FromResult(item?.OrganizationId == organizationId
                && item.ProjectId == projectId && _aiConnections.Remove(connectionId));
        }
    }
}