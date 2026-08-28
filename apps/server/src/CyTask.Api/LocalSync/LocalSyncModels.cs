using CyTask.Api.Collaboration;
using CyTask.Api.Domain;
using CyTask.Api.Plugins;

namespace CyTask.Api.LocalSync;

public sealed record LocalMembership(Guid UserId, Guid OrganizationId, string Role);

public sealed record LocalTaskDependency(
    Guid OrganizationId,
    Guid TaskId,
    Guid DependsOnTaskId,
    Guid CreatedBy,
    DateTimeOffset CreatedAt);

public sealed record WorkspaceLocalState(
    IReadOnlyList<UserAccount> Users,
    IReadOnlyList<Organization> Organizations,
    IReadOnlyList<LocalMembership> Memberships,
    IReadOnlyList<Project> Projects,
    IReadOnlyList<ProjectStatus> ProjectStatuses,
    IReadOnlyList<ProjectLabel> ProjectLabels,
    IReadOnlyList<TaskLabelAssignment> TaskLabels,
    IReadOnlyList<WorkItem> Tasks,
    IReadOnlyList<TaskParentAssignment> TaskParents,
    IReadOnlyList<Comment> Comments,
    IReadOnlyList<ActivityEntry> Activity,
    IReadOnlyList<Attachment> Attachments,
    IReadOnlyList<ExternalReference> ExternalReferences,
    IReadOnlyList<LocalTaskDependency> TaskDependencies,
    IReadOnlyList<TaskChecklistItem> Checklist);

public sealed record CollaborationLocalState(
    IReadOnlyList<ProjectResource> Resources,
    IReadOnlyList<ChatChannel> Channels,
    IReadOnlyList<ChatMessage> Messages);

public sealed record PluginLocalState(
    IReadOnlyList<ProjectPluginState> ProjectPlugins,
    IReadOnlyList<TaskPluginData> TaskData,
    IReadOnlyList<TaskPluginData> TaskDataHistory);

public sealed record LocalSyncPayload(
    WorkspaceLocalState Workspace,
    CollaborationLocalState Collaboration,
    PluginLocalState Plugins);

public sealed record LocalSyncTombstone(
    string EntityType,
    string EntityId,
    long Revision,
    Guid DeviceId,
    DateTimeOffset DeletedAt);
public sealed record LocalSyncEnvelope(
    int FormatVersion,
    Guid WorkspaceId,
    Guid DeviceId,
    long Sequence,
    DateTimeOffset CapturedAt,
    LocalSyncPayload Payload,
    IReadOnlyList<LocalSyncTombstone>? Tombstones = null);

public sealed record LocalSyncManifest(
    int FormatVersion,
    Guid WorkspaceId,
    DateTimeOffset CreatedAt,
    string Transport,
    string DataFormat);

public sealed record LocalSyncConflict(
    string Id,
    string EntityType,
    string EntityId,
    long Revision,
    Guid FirstDeviceId,
    Guid SecondDeviceId,
    string FirstHash,
    string SecondHash,
    DateTimeOffset DetectedAt);

public sealed record LocalSyncStatus(
    bool Enabled,
    string Mode,
    string? WorkspacePath,
    Guid? WorkspaceId,
    Guid? DeviceId,
    int PeerDeviceCount,
    int SnapshotCount,
    int ConflictCount,
    DateTimeOffset? LastSnapshotAt,
    string? Message);

public interface ILocalSyncService
{
    LocalSyncStatus Status { get; }

    Task InitializeAsync(CancellationToken cancellationToken);

    Task<LocalSyncStatus> FlushAsync(CancellationToken cancellationToken);
}

public sealed class DisabledLocalSyncService : ILocalSyncService
{
    public LocalSyncStatus Status { get; } = new(
        false, "server", null, null, null, 0, 0, 0, null,
        "Le serveur utilise sa base centrale ; aucun dossier local n’est actif.");

    public Task InitializeAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public Task<LocalSyncStatus> FlushAsync(CancellationToken cancellationToken) =>
        Task.FromResult(Status);
}