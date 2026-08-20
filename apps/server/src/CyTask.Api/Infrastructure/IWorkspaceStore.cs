using CyTask.Api.Domain;

namespace CyTask.Api.Infrastructure;

public interface IWorkspaceStore
{
    Task<bool> IsReadyAsync(CancellationToken cancellationToken);

    Task<bool> HasUsersAsync(CancellationToken cancellationToken);

    Task<BootstrapResult?> BootstrapAsync(
        string email,
        string displayName,
        string passwordHash,
        string organizationName,
        string organizationSlug,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken);

    Task<UserAccount?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken);

    Task<LoginResult?> CreateSessionAsync(
        Guid userId,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken);

    Task<AuthenticatedUser?> FindSessionAsync(byte[] sessionHash, CancellationToken cancellationToken);

    Task DeleteSessionAsync(byte[] sessionHash, CancellationToken cancellationToken);

    Task<bool> CreateNativeAuthorizationAsync(
        Guid userId,
        Guid organizationId,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] codeHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken);

    Task<AuthenticatedUser?> RedeemNativeAuthorizationAsync(
        byte[] codeHash,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] accessTokenHash,
        DateTimeOffset accessTokenExpiresAt,
        CancellationToken cancellationToken);

    Task<AuthenticatedUser?> FindAccessTokenAsync(
        byte[] accessTokenHash,
        CancellationToken cancellationToken);

    Task DeleteAccessTokenAsync(byte[] accessTokenHash, CancellationToken cancellationToken);

    Task<IReadOnlyList<OrganizationMember>> ListMembersAsync(
        Guid organizationId,
        CancellationToken cancellationToken);

    Task<CreatedInvitation?> CreateInvitationAsync(
        Guid organizationId,
        Guid createdBy,
        string email,
        string role,
        string token,
        byte[] tokenHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken);

    Task<InvitationPreview?> FindInvitationAsync(byte[] tokenHash, CancellationToken cancellationToken);

    Task<LoginResult?> AcceptInvitationAsync(
        byte[] tokenHash,
        string displayName,
        string passwordHash,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ActivityEntry>> ListActivityAsync(
        Guid organizationId,
        int limit,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<SearchHit>> SearchAsync(
        Guid organizationId,
        string query,
        int limit,
        CancellationToken cancellationToken);

    Task<WorkspaceExport?> ExportAsync(Guid organizationId, CancellationToken cancellationToken);

    Task<IReadOnlyList<Attachment>?> ListAttachmentsAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken);

    Task<AttachmentUpload?> CreateAttachmentUploadAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        Guid attachmentId,
        Guid uploadId,
        string fileName,
        string declaredContentType,
        long sizeBytes,
        string sha256,
        bool optimizedLocally,
        int chunkSizeBytes,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken);

    Task<AttachmentUpload?> GetAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken);

    Task<RecordChunkResult> RecordAttachmentChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        long sizeBytes,
        string sha256,
        CancellationToken cancellationToken);

    Task<Attachment?> CompleteAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string detectedContentType,
        CancellationToken cancellationToken);

    Task RejectAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<ExternalReference>?> ListExternalReferencesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken);

    Task<ExternalReference?> CreateExternalReferenceAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        string provider,
        string repository,
        string referenceType,
        string referenceValue,
        string label,
        string? webUrl,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<Project>> ListProjectsAsync(Guid organizationId, CancellationToken cancellationToken);

    Task<Project?> CreateProjectAsync(
        Guid organizationId,
        Guid userId,
        string name,
        string key,
        CancellationToken cancellationToken);

    Task<IReadOnlyList<WorkItem>?> ListTasksAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken);

    Task<WorkItem?> CreateTaskAsync(
        Guid organizationId,
        Guid projectId,
        Guid userId,
        string title,
        string description,
        string priority,
        DateTimeOffset? dueAt,
        Guid? assigneeId,
        CancellationToken cancellationToken);

    Task<TaskDetails?> GetTaskAsync(Guid organizationId, Guid taskId, CancellationToken cancellationToken);

    Task<TaskDependencyOverview?> GetTaskDependenciesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken);

    Task<AddTaskDependencyResult> AddTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken);

    Task<bool> RemoveTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken);

    Task<UpdateTaskResult> UpdateTaskAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        string title,
        string description,
        string status,
        string priority,
        DateTimeOffset? dueAt,
        Guid? assigneeId,
        long expectedRevision,
        CancellationToken cancellationToken);

    Task<Comment?> AddCommentAsync(
        Guid organizationId,
        Guid taskId,
        Guid authorId,
        string body,
        CancellationToken cancellationToken);
}
