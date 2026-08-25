using System.Text.Json.Serialization;

namespace CyTask.Api.Endpoints;

public sealed record BootstrapRequest(
    string Email,
    string DisplayName,
    string Password,
    string OrganizationName);

public sealed record LoginRequest(string Email, string Password);

public sealed record CreateNativeAuthorizationRequest(
    string ClientId,
    string RedirectUri,
    string CodeChallenge,
    string CodeChallengeMethod,
    string State);

public sealed record InvitationTokenRequest(string Token);

public sealed record CreateInvitationRequest(string Email, string Role);

public sealed record AcceptInvitationRequest(string Token, string DisplayName, string Password);

public sealed record CreateProjectRequest(string Name, string Key);

public sealed record CreateApiTokenRequest(string Name, string Scope, int? ExpiresInDays);

public sealed record CreateTaskRequest(
    string Title,
    string? Description,
    string? Priority = null,
    DateTimeOffset? DueAt = null,
    Guid? AssigneeId = null);

public sealed record CreateCommentRequest(string Body);

public sealed record CreateTaskDependencyRequest(Guid DependsOnTaskId);

public sealed record CreateChecklistItemRequest(string Title);

public sealed record UpdateChecklistItemRequest(
    string Title,
    bool IsCompleted,
    long ExpectedRevision);


public sealed record CreateProjectLabelRequest(string Name, string Color);
public sealed class UpdateTaskRequest
{
    private string? priority;
    private DateTimeOffset? dueAt;
    private Guid? assigneeId;

    public string Title { get; init; } = string.Empty;

    public string? Description { get; init; }

    public string Status { get; init; } = string.Empty;

    public long ExpectedRevision { get; init; }

    public string? Priority
    {
        get => priority;
        init
        {
            priority = value;
            PrioritySpecified = true;
        }
    }

    public DateTimeOffset? DueAt
    {
        get => dueAt;
        init
        {
            dueAt = value;
            DueAtSpecified = true;
        }
    }

    public Guid? AssigneeId
    {
        get => assigneeId;
        init
        {
            assigneeId = value;
            AssigneeIdSpecified = true;
        }
    }

    [JsonIgnore]
    public bool PrioritySpecified { get; private set; }

    [JsonIgnore]
    public bool DueAtSpecified { get; private set; }

    [JsonIgnore]
    public bool AssigneeIdSpecified { get; private set; }
}

public sealed record CreateAttachmentUploadRequest(
    string FileName,
    string ContentType,
    long SizeBytes,
    string Sha256,
    bool OptimizedLocally);

public sealed record CreateExternalReferenceRequest(
    string Provider,
    string Repository,
    string ReferenceType,
    string ReferenceValue,
    string Label,
    string? WebUrl);

public sealed record SessionResponse(
    Guid UserId,
    Guid OrganizationId,
    string Email,
    string DisplayName,
    string Role,
    string CsrfToken);

public sealed record NativeAuthorizationResponse(string RedirectUri, DateTimeOffset ExpiresAt);

public sealed record NativeTokenResponse(
    [property: JsonPropertyName("access_token")] string AccessToken,
    [property: JsonPropertyName("token_type")] string TokenType,
    [property: JsonPropertyName("expires_in")] int ExpiresIn,
    string Scope);
