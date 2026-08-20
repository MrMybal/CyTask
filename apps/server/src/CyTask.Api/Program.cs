using System.Threading.RateLimiting;
using CyTask.Api.Configuration;
using CyTask.Api.Endpoints;
using CyTask.Api.Infrastructure;
using CyTask.Api.Media;
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
});

builder.Services.AddSingleton<PasswordService>();
builder.Services.AddSingleton<WorkspaceEventHub>();
builder.Services.AddSingleton<LocalMediaStorage>();
builder.Services.AddSingleton<RequireSessionFilter>();
builder.Services.AddSingleton<RequireCookieSessionFilter>();
builder.Services.AddSingleton<RequireBearerTokenFilter>();
builder.Services.AddSingleton<CsrfFilter>();
builder.Services.AddSingleton<AttachmentReviewService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<AttachmentReviewService>());

if (cyTaskOptions.UseInMemoryStore)
{
    builder.Services.AddSingleton<IWorkspaceStore, InMemoryWorkspaceStore>();
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
    builder.Services.AddSingleton<DatabaseMigrator>();
}

var app = builder.Build();

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
        context.Response.Headers.Append("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        var policy = context.Request.Path.StartsWithSegments("/api") ||
                     context.Request.Path.StartsWithSegments("/health")
            ? "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
            : "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
              "connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
        context.Response.Headers.Append("Content-Security-Policy", policy);
        return Task.CompletedTask;
    });
    return next();
});
app.UseRateLimiter();
app.UseMiddleware<SessionMiddleware>();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapCyTaskApi();
app.Map("/api/{**path}", () => Results.NotFound());
app.MapFallbackToFile("index.html");

app.Run();

public partial class Program;
