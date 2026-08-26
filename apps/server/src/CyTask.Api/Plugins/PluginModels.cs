using System.Text.Json;

namespace CyTask.Api.Plugins;

public sealed record PluginFieldDefinition(
    string Key,
    string Label,
    string Type,
    bool Required = false,
    string? Description = null,
    string? Placeholder = null,
    int? MaxLength = null,
    IReadOnlyList<string>? Options = null);

public sealed record PluginTaskTabDefinition(
    string Id,
    string Title,
    string Icon,
    IReadOnlyList<PluginFieldDefinition> Fields);

public sealed record PluginContributions(
    IReadOnlyList<PluginTaskTabDefinition> TaskTabs);

public sealed record PluginManifest(
    int SchemaVersion,
    string Id,
    string Name,
    string Description,
    string Version,
    string ApiVersion,
    string Runtime,
    IReadOnlyList<string> Permissions,
    PluginContributions Contributes,
    string? Homepage = null);

public sealed record ProjectPluginState(
    Guid OrganizationId,
    Guid ProjectId,
    string PluginId,
    bool Enabled,
    Guid EnabledBy,
    DateTimeOffset EnabledAt);

public sealed record TaskPluginData(
    Guid OrganizationId,
    Guid ProjectId,
    Guid TaskId,
    string PluginId,
    JsonElement Data,
    long Revision,
    Guid UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record ProjectPluginView(
    PluginManifest Manifest,
    bool Enabled,
    DateTimeOffset? EnabledAt);

public sealed record TaskPluginView(
    PluginManifest Manifest,
    JsonElement Data,
    long Revision,
    DateTimeOffset? UpdatedAt);

public sealed record TaskPluginHistoryView(
    JsonElement Data,
    long Revision,
    Guid UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record UpdateTaskPluginDataRequest(
    JsonElement Data,
    long ExpectedRevision);
