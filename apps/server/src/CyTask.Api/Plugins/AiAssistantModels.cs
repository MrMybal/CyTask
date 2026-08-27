namespace CyTask.Api.Plugins;

public static class AiProviderIds
{
    public const string OpenAi = "openai";
    public const string Anthropic = "anthropic";
    public const string OpenAiCompatible = "openai-compatible";
    public const string Ollama = "ollama";
    public const string LmStudio = "lm-studio";
    public const string Codex = "codex";
    public const string ClaudeCode = "claude-code";
    public const string OpenCode = "opencode";

    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        OpenAi, Anthropic, OpenAiCompatible, Ollama, LmStudio, Codex, ClaudeCode, OpenCode
    };

    public static bool NeedsSecret(string provider) =>
        provider is OpenAi or Anthropic or OpenAiCompatible;

    public static bool IsLocalAgent(string provider) =>
        provider is Codex or ClaudeCode or OpenCode;

    public static string AuthenticationMode(string provider) =>
        NeedsSecret(provider) ? "api-token" : IsLocalAgent(provider) ? "local-account" : "none";
}

public sealed record AiProviderConnection(
    Guid Id,
    Guid OrganizationId,
    Guid ProjectId,
    string Name,
    string Provider,
    string Model,
    string? BaseUrl,
    string? ProtectedSecret,
    string? SecretHint,
    long Revision,
    Guid CreatedBy,
    DateTimeOffset CreatedAt,
    Guid UpdatedBy,
    DateTimeOffset UpdatedAt);

public sealed record AiProviderConnectionView(
    Guid Id,
    string Name,
    string Provider,
    string AuthenticationMode,
    string Model,
    string? BaseUrl,
    bool HasSecret,
    string? SecretHint,
    bool LocalExecutionEnabled,
    long Revision,
    DateTimeOffset UpdatedAt);

public sealed record CreateAiProviderConnectionRequest(
    string Name,
    string Provider,
    string Model,
    string? BaseUrl,
    string? Secret);

public sealed record UpdateAiProviderConnectionRequest(
    string Name,
    string Provider,
    string Model,
    string? BaseUrl,
    string? Secret,
    bool ClearSecret,
    long ExpectedRevision);

public sealed record RunAiAssistantRequest(
    Guid ConnectionId,
    string Goal,
    string OutputMode,
    string Instructions,
    bool IncludeComments);

public sealed record AiAssistantRunResult(
    string Text,
    string Provider,
    string Model,
    long DurationMilliseconds);