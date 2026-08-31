using System.Threading.RateLimiting;
using CyTask.Api.Collaboration;
using CyTask.Api.Configuration;
using CyTask.Api.Endpoints;
using CyTask.Api.Infrastructure;
using CyTask.Api.LocalSync;
using CyTask.Api.Media;
using CyTask.Api.Migrations;
using CyTask.Api.Plugins;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using Microsoft.AspNetCore.Http.Json;
using Npgsql;

if (args is ["--health-check"])
{
    using var healthClient = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    try
    {
        using var response = await healthClient.GetAsync(
            new Uri("http://127.0.0.1:8080/health/ready"), CancellationToken.None);
        Environment.ExitCode = response.IsSuccessStatusCode ? 0 : 1;
    }
    catch (HttpRequestException)
    {
        Environment.ExitCode = 1;
    }
    catch (TaskCanceledException)
    {
        Environment.ExitCode = 1;
    }

    return;
}

var builder = WebApplication.CreateBuilder(args);

builder.Logging.ClearProviders();
builder.Logging.AddSimpleConsole(options =>
{
    options.SingleLine = true;
    options.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ ";
    options.UseUtcTimestamp = true;
});

builder.Services.AddOptions<CyTaskOptions>()
    .Bind(builder.Configuration.GetSection(CyTaskOptions.SectionName))
    .Validate(options => !options.LocalMode || options.UseInMemoryStore,
        "LocalMode requires UseInMemoryStore.")
    .Validate(options => !options.LocalMode || !string.IsNullOrWhiteSpace(options.LocalWorkspacePath),
        "LocalWorkspacePath is required in local mode.")
    .Validate(options => !options.LocalMode || Guid.TryParse(options.LocalDeviceId, out var deviceId) && deviceId != Guid.Empty,
        "LocalDeviceId must be a non-empty GUID in local mode.")
    .Validate(options => string.IsNullOrWhiteSpace(options.LocalSessionStoragePath)
        || Path.IsPathFullyQualified(options.LocalSessionStoragePath),
        "LocalSessionStoragePath must be an absolute path when configured.")
    .Validate(options => options.LocalSyncSeconds is >= 1 and <= 60,
        "LocalSyncSeconds must be between 1 and 60.")
    .Validate(options => options.SessionHours is >= 1 and <= 168, "SessionHours must be between 1 and 168.")
    .Validate(options => options.NativeAuthorizationCodeMinutes is >= 1 and <= 10,
        "NativeAuthorizationCodeMinutes must be between 1 and 10.")
    .Validate(options => options.NativeAccessTokenMinutes is >= 5 and <= 1440,
        "NativeAccessTokenMinutes must be between 5 and 1440.")
    .Validate(options => options.InvitationHours is >= 1 and <= 168,
        "InvitationHours must be between 1 and 168.")
    .Validate(options => options.MaxRequestBodyBytes is >= 16_384 and <= 10_485_760,
        "MaxRequestBodyBytes must be between 16 KiB and 10 MiB.")
    .Validate(options => options.MaxAttachmentBytes is >= 1_048_576 and <= 53_687_091_200,
        "MaxAttachmentBytes must be between 1 MiB and 50 GiB.")
    .Validate(options => options.UploadChunkBytes is >= 65_536 and <= 10_485_760,
        "UploadChunkBytes must be between 64 KiB and 10 MiB.")
    .Validate(options => options.UploadChunkBytes <= options.MaxRequestBodyBytes,
        "UploadChunkBytes must not exceed MaxRequestBodyBytes.")
    .Validate(options => options.UploadHours is >= 1 and <= 72,
        "UploadHours must be between 1 and 72.")
    .Validate(options => !string.IsNullOrWhiteSpace(options.MediaStoragePath),
        "MediaStoragePath is required.")
    .Validate(options => options.MediaReviewSeconds is >= 1 and <= 3600,
        "MediaReviewSeconds must be between 1 second and 1 hour.")
    .Validate(options => options.MediaReviewBatch is >= 1 and <= 128,
        "MediaReviewBatch must be between 1 and 128.")
    .Validate(options => options.MediaReviewAttempts is >= 1 and <= 10,
        "MediaReviewAttempts must be between 1 and 10.")
    .Validate(options => options.MaxMediaDimension is >= 16 and <= 1_000_000,
        "MaxMediaDimension must be between 16 and 1000000 pixels.")
    .Validate(options => options.MaxMediaPixels is >= 65_536 and <= 100_000_000_000,
        "MaxMediaPixels must be between 65536 and 100 billion pixels.")
    .Validate(options => options.MaxApiTokensPerUser is >= 1 and <= 100,
        "MaxApiTokensPerUser must be between 1 and 100.")
    .Validate(options => options.OutboxPollMilliseconds is >= 50 and <= 60_000,
        "OutboxPollMilliseconds must be between 50 and 60000.")
    .Validate(options => options.OutboxBatchSize is >= 1 and <= 512,
        "OutboxBatchSize must be between 1 and 512.")
    .Validate(options => options.OutboxLeaseSeconds is >= 5 and <= 300,
        "OutboxLeaseSeconds must be between 5 and 300.")
    .Validate(options => options.OutboxRetentionDays is >= 1 and <= 90,
        "OutboxRetentionDays must be between 1 and 90.")
    .Validate(options => options.EventReplayBatchSize is >= 16 and <= 1024,
        "EventReplayBatchSize must be between 16 and 1024.")
    .Validate(options => options.SseHeartbeatSeconds is >= 5 and <= 60,
        "SseHeartbeatSeconds must be between 5 and 60.")
    .Validate(options => options.UseInMemoryStore || AiSecretProtector.IsValidKey(options.PluginSecretKey),
        "PluginSecretKey must be a base64-encoded 32-byte key when persistent storage is enabled.")
    .Validate(options => options.AiRequestTimeoutSeconds is >= 10 and <= 600,
        "AiRequestTimeoutSeconds must be between 10 and 600.")
    .Validate(options => options.AiMaxOutputCharacters is >= 1_000 and <= 200_000,
        "AiMaxOutputCharacters must be between 1000 and 200000.")
    .Validate(options =>
    {
        var value = options.CyAnnotaUrl.Trim();
        return value.Length > 1 && value[0] == '/'
            && !value.StartsWith("//", StringComparison.Ordinal)
            && !value.Contains((char)92) && !value.Contains('?') && !value.Contains('#');
    }, "CyAnnotaUrl must be a safe root-relative path served by the CyTask origin.")
    .Validate(options => !options.AiLocalAgentsEnabled
        || !string.IsNullOrWhiteSpace(options.AiLocalWorkspacePath),
        "AiLocalWorkspacePath is required when local agents are enabled.")
    .ValidateOnStart();

var cyTaskOptions = builder.Configuration
    .GetSection(CyTaskOptions.SectionName)
    .Get<CyTaskOptions>() ?? new CyTaskOptions();

builder.WebHost.ConfigureKestrel(options =>
{
    options.AddServerHeader = false;
    options.Limits.MaxRequestBodySize = cyTaskOptions.MaxRequestBodyBytes;
    options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(15);
});
builder.Services.Configure<JsonOptions>(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.SerializerOptions.DictionaryKeyPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
});
builder.Services.AddProblemDetails();
builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("authentication", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 8,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
    options.AddPolicy("ai-assistant", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 12,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
    options.AddPolicy("uploads", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 180,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
    options.AddPolicy("migration", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.Connection.RemoteIpAddress?.ToString() ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 8,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true
            }));
});

builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<OutboxDispatchSignal>();
builder.Services.AddSingleton<WorkspaceEventHub>();
builder.Services.AddSingleton<PluginCatalog>();
builder.Services.AddSingleton<AiSecretProtector>();
builder.Services.AddSingleton<AiAssistantExecutor>();
builder.Services.AddSingleton<MigrationSourceClient>();
builder.Services.AddSingleton<MigrationService>();
builder.Services.AddHttpClient("ai-assistant", client =>
{
    client.DefaultRequestHeaders.UserAgent.ParseAdd("CyTask-AI-Assistant/0.2");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = false,
    AutomaticDecompression = System.Net.DecompressionMethods.GZip
        | System.Net.DecompressionMethods.Deflate
});
builder.Services.AddHttpClient("migration", client =>
{
    client.Timeout = TimeSpan.FromSeconds(45);
    client.MaxResponseContentBufferSize = 25_000_000;
    client.DefaultRequestHeaders.UserAgent.ParseAdd("CyTask-Migrator/0.1");
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = false,
    AutomaticDecompression = System.Net.DecompressionMethods.GZip
        | System.Net.DecompressionMethods.Deflate
});
builder.Services.AddSingleton<LocalMediaStorage>();
builder.Services.AddSingleton<ChatSignalHub>();
builder.Services.AddSingleton<RequireSessionFilter>();
builder.Services.AddSingleton<RequireCookieSessionFilter>();
builder.Services.AddSingleton<RequireBearerTokenFilter>();
builder.Services.AddSingleton<CsrfFilter>();
builder.Services.AddSingleton<AttachmentReviewService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<AttachmentReviewService>());

if (cyTaskOptions.UseInMemoryStore)
{
    builder.Services.AddSingleton<InMemoryWorkspaceStore>();
    builder.Services.AddSingleton<IWorkspaceStore>(provider => provider.GetRequiredService<InMemoryWorkspaceStore>());
    builder.Services.AddSingleton<InMemoryCollaborationStore>();
    builder.Services.AddSingleton<ICollaborationStore>(provider => provider.GetRequiredService<InMemoryCollaborationStore>());
    builder.Services.AddSingleton<InMemoryPluginStore>();
    builder.Services.AddSingleton<IPluginStore>(provider => provider.GetRequiredService<InMemoryPluginStore>());
    builder.Services.AddSingleton<LocalSyncCoordinator>();
    builder.Services.AddSingleton<ILocalSyncService>(provider => provider.GetRequiredService<LocalSyncCoordinator>());
    builder.Services.AddHostedService(provider => provider.GetRequiredService<LocalSyncCoordinator>());
    builder.Services.AddSingleton<ICyAnnotaStore, InMemoryCyAnnotaStore>();
    builder.Services.AddSingleton<IWorkspaceEventReplayStore>(
        provider => provider.GetRequiredService<WorkspaceEventHub>());
}
else
{
    if (string.IsNullOrWhiteSpace(cyTaskOptions.DatabaseConnection))
    {
        throw new InvalidOperationException(
            "CyTask:DatabaseConnection is required unless CyTask:UseInMemoryStore is explicitly enabled.");
    }

    builder.Services.AddSingleton(_ =>
    {
        var dataSourceBuilder = new NpgsqlDataSourceBuilder(cyTaskOptions.DatabaseConnection);
        dataSourceBuilder.ConnectionStringBuilder.ApplicationName = "CyTask.Api";
        dataSourceBuilder.ConnectionStringBuilder.Timeout = 5;
        dataSourceBuilder.ConnectionStringBuilder.CommandTimeout = 15;
        return dataSourceBuilder.Build();
    });
    builder.Services.AddSingleton<IWorkspaceStore, PostgresWorkspaceStore>();
    builder.Services.AddSingleton<ICollaborationStore, PostgresCollaborationStore>();
    builder.Services.AddSingleton<IPluginStore, PostgresPluginStore>();
    builder.Services.AddSingleton<ICyAnnotaStore, PostgresCyAnnotaStore>();
    builder.Services.AddSingleton<PostgresOutboxEventStore>();
    builder.Services.AddSingleton<IWorkspaceEventReplayStore>(
        provider => provider.GetRequiredService<PostgresOutboxEventStore>());
    builder.Services.AddSingleton<IOutboxEventStore>(
        provider => provider.GetRequiredService<PostgresOutboxEventStore>());
    builder.Services.AddSingleton<OutboxDispatcher>();
    builder.Services.AddHostedService(provider => provider.GetRequiredService<OutboxDispatcher>());
    builder.Services.AddSingleton<DatabaseMigrator>();
    builder.Services.AddSingleton<ILocalSyncService, DisabledLocalSyncService>();
}

var app = builder.Build();

await app.Services.GetRequiredService<ILocalSyncService>()
    .InitializeAsync(app.Lifetime.ApplicationStopping);

if (!cyTaskOptions.UseInMemoryStore && cyTaskOptions.ApplyMigrations)
{
    await app.Services.GetRequiredService<DatabaseMigrator>().ApplyAsync(app.Lifetime.ApplicationStopping);
}

if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}

app.UseExceptionHandler();
app.Use((context, next) =>
{
    context.Response.OnStarting(() =>
    {
        context.Response.Headers.XContentTypeOptions = "nosniff";
        context.Response.Headers.Append("Referrer-Policy", "no-referrer");
        context.Response.Headers.Append(
            "Permissions-Policy",
            "camera=(self), microphone=(self), display-capture=(self), geolocation=()");
        var isApi = context.Request.Path.StartsWithSegments("/api") ||
                    context.Request.Path.StartsWithSegments("/health");
        var isCyAnnota = context.Request.Path.StartsWithSegments("/plugins/cyannota");
        var policy = isApi
            ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            : isCyAnnota
                ? "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
                  "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; " +
                  "connect-src 'self' blob:; worker-src 'self' blob:; child-src 'self' blob:; " +
                  "object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'none'"
                : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
                  "connect-src 'self'; frame-src 'self'; object-src 'none'; frame-ancestors 'none'; " +
                  "base-uri 'self'; form-action 'self'";
        context.Response.Headers.Append("Content-Security-Policy", policy);
        return Task.CompletedTask;
    });
    return next();
});
app.UseRateLimiter();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) });
app.UseMiddleware<SessionMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapCyTaskApi();
app.Map("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("/plugins/cyannota/{*path:nonfile}", "plugins/cyannota/index.html");
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
