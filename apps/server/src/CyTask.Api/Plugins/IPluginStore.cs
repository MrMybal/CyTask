using System.Text.Json;

namespace CyTask.Api.Plugins;

public interface IPluginStore
{
    Task<IReadOnlyList<ProjectPluginState>> ListProjectPluginsAsync(
        Guid organizationId, Guid projectId, CancellationToken cancellationToken);

    Task<ProjectPluginState> EnableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId, Guid userId,
        CancellationToken cancellationToken);

    Task<bool> DisableProjectPluginAsync(
        Guid organizationId, Guid projectId, string pluginId,
        CancellationToken cancellationToken);

    Task<TaskPluginData?> GetTaskPluginDataAsync(
        Guid organizationId, Guid taskId, string pluginId,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<TaskPluginData>> ListTaskPluginDataHistoryAsync(
        Guid organizationId, Guid taskId, string pluginId, int limit,
        CancellationToken cancellationToken);

    Task<TaskPluginData?> UpsertTaskPluginDataAsync(
        Guid organizationId, Guid projectId, Guid taskId, string pluginId,
        JsonElement data, long expectedRevision, Guid userId,
        CancellationToken cancellationToken);
}
