namespace CyTask.Api.Configuration;

public sealed class CyTaskOptions
{
    public const string SectionName = "CyTask";
    public string? DatabaseConnection { get; init; }
    public bool ApplyMigrations { get; init; }
    public bool UseInMemoryStore { get; init; }
    public int SessionHours { get; init; } = 12;
    public int NativeAuthorizationCodeMinutes { get; init; } = 5;
    public int NativeAccessTokenMinutes { get; init; } = 60;
    public int InvitationHours { get; init; } = 72;
    public int MaxRequestBodyBytes { get; init; } = 5_242_880;
    public long MaxAttachmentBytes { get; init; } = 2_147_483_648;
    public int UploadChunkBytes { get; init; } = 4_194_304;
    public int UploadHours { get; init; } = 24;
    public string MediaStoragePath { get; init; } = ".data/media";
    public int MediaReviewSeconds { get; init; } = 5;
    public int MediaReviewBatch { get; init; } = 8;
    public int MediaReviewAttempts { get; init; } = 3;
    public int MaxMediaDimension { get; init; } = 20_000;
    public long MaxMediaPixels { get; init; } = 80_000_000;
    public int MaxApiTokensPerUser { get; init; } = 20;
    public int OutboxPollMilliseconds { get; init; } = 250;
    public int OutboxBatchSize { get; init; } = 64;
    public int OutboxLeaseSeconds { get; init; } = 30;
    public int OutboxRetentionDays { get; init; } = 7;
    public int EventReplayBatchSize { get; init; } = 256;
    public int SseHeartbeatSeconds { get; init; } = 15;
    public string? PluginSecretKey { get; init; }
    public string CyAnnotaUrl { get; init; } = "/plugins/cyannota/";
    public bool AiLocalAgentsEnabled { get; init; }
    public string? AiLocalWorkspacePath { get; init; }
    public string CodexExecutable { get; init; } = "codex";
    public string ClaudeExecutable { get; init; } = "claude";
    public string OpenCodeExecutable { get; init; } = "opencode";
    public bool AiAllowPrivateEndpoints { get; init; }
    public int AiRequestTimeoutSeconds { get; init; } = 120;
    public int AiMaxOutputCharacters { get; init; } = 50_000;
}