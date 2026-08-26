using System.Text.Json;

namespace CyTask.Api.Plugins;

public sealed class InMemoryPluginStore : IPluginStore
{
    private readonly Lock _gate = new();
    private readonly Dictionary<(Guid ProjectId, string PluginId), ProjectPluginState> _projects = [];
    private readonly Dictionary<(Guid TaskId, string PluginId), TaskPluginData> _tasks = [];
    private readonly Dictionary<(Guid TaskId, string PluginId), List<TaskPluginData>> _history = [];

    public Task<IReadOnlyList<ProjectPluginState>> ListProjectPluginsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<ProjectPluginState> result = _projects.Values
                .Where(plugin => plugin.OrganizationId == organizationId && plugin.ProjectId == projectId)
                .OrderBy(plugin => plugin.PluginId, StringComparer.Ordinal)
                .ToArray();
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
            {
                return Task.FromResult(current);
            }

            var state = new ProjectPluginState(
                organizationId, projectId, pluginId, true, userId, DateTimeOffset.UtcNow);
            _projects[key] = state;
            return Task.FromResult(state);
        }
    }

    public Task<bool> DisableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = (projectId, pluginId);
            return Task.FromResult(
                _projects.TryGetValue(key, out var current)
                && current.OrganizationId == organizationId
                && _projects.Remove(key));
        }
    }

    public Task<TaskPluginData?> GetTaskPluginDataAsync(
        Guid organizationId, Guid taskId, string pluginId,
        CancellationToken cancellationToken)
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
                .Take(Math.Clamp(limit, 1, 100))
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<TaskPluginData?> UpsertTaskPluginDataAsync(
        Guid organizationId, Guid projectId, Guid taskId, string pluginId,
        JsonElement data, long expectedRevision, Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = (taskId, pluginId);
            var current = _tasks.GetValueOrDefault(key);
            if ((current is null && expectedRevision != 0)
                || (current is not null && (current.OrganizationId != organizationId
                    || current.ProjectId != projectId
                    || current.Revision != expectedRevision)))
            {
                return Task.FromResult<TaskPluginData?>(null);
            }

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
}
