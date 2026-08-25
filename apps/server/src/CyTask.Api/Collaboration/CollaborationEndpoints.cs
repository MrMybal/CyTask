using System.Text;
using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Media;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    public static RouteGroupBuilder MapCollaborationEndpoints(this RouteGroupBuilder authenticated)
    {
        authenticated.MapGet("/projects/{projectId:guid}/resources", ListResourcesAsync);
        authenticated.MapPost("/projects/{projectId:guid}/resources", CreateResourceAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/resources/{resourceId:guid}", GetResourceAsync);
        authenticated.MapPatch("/resources/{resourceId:guid}", UpdateResourceAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/resources/{resourceId:guid}/content", DownloadResourceAsync);
        authenticated.MapPost("/projects/{projectId:guid}/resource-uploads", CreateResourceUploadAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/resource-uploads/{uploadId:guid}", GetResourceUploadAsync);
        authenticated.MapPut("/resource-uploads/{uploadId:guid}/chunks/{index:int}", UploadResourceChunkAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapPost("/resource-uploads/{uploadId:guid}/complete", CompleteResourceUploadAsync)
            .RequireRateLimiting("uploads")
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));

        authenticated.MapGet("/projects/{projectId:guid}/chat/channels", ListChannelsAsync);
        authenticated.MapPost("/projects/{projectId:guid}/chat/channels", CreateChannelAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/chat/channels/{channelId:guid}/messages", ListMessagesAsync);
        authenticated.MapPost("/chat/channels/{channelId:guid}/messages", CreateMessageAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        authenticated.MapGet("/chat/channels/{channelId:guid}/signal", SignalAsync)
            .AddEndpointFilter<RequireCookieSessionFilter>();
        return authenticated;
    }

    private static string SafeContentType(string? contentType) => contentType switch
    {
        "image/png" or "image/jpeg" or "image/gif" or "image/webp" or
            "video/mp4" or "video/webm" => contentType,
        _ => "application/octet-stream"
    };

    private static IResult Validation(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
