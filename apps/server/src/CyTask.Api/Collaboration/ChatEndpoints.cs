using CyTask.Api.Realtime;
using CyTask.Api.Security;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task<IResult> ListChannelsAsync(
        Guid projectId, HttpContext context, ICollaborationStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var channels = await store.ListChannelsAsync(
            user.OrganizationId, projectId, cancellationToken);
        return channels is null ? Results.NotFound() : Results.Ok(channels);
    }

    private static async Task<IResult> CreateChannelAsync(
        Guid projectId, CreateChatChannelRequest request, HttpContext context,
        ICollaborationStore store, WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var name = request.Name.Trim();
        var topic = request.Topic?.Trim() ?? string.Empty;
        var slug = SessionSecurity.CreateSlug(name);
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 80 || name.Any(char.IsControl) || slug.Length is < 1 or > 80)
            errors[nameof(request.Name)] = ["Le nom du salon doit contenir entre 1 et 80 caractères."];
        if (topic.Length > 500 || topic.Any(character => char.IsControl(character)
                && character is not '\n' and not '\r' and not '\t'))
            errors[nameof(request.Topic)] = ["Le sujet ne peut pas dépasser 500 caractères."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);
        var user = context.GetUser()!;
        var channel = await store.CreateChannelAsync(
            user.OrganizationId, projectId, name, slug, topic, user.UserId, cancellationToken);
        if (channel is null) return Results.NotFound();
        events.Publish(user.OrganizationId, "chat.channel_created", channel.Id);
        return Results.Created($"/api/v1/chat/channels/{channel.Id}", channel);
    }

    private static async Task<IResult> ListMessagesAsync(
        Guid channelId, int? limit, DateTimeOffset? before, HttpContext context,
        ICollaborationStore store, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var messages = await store.ListMessagesAsync(
            user.OrganizationId, channelId, Math.Clamp(limit ?? 80, 1, 100), before,
            cancellationToken);
        return messages is null ? Results.NotFound() : Results.Ok(messages);
    }

    private static async Task<IResult> CreateMessageAsync(
        Guid channelId, CreateChatMessageRequest request, HttpContext context,
        ICollaborationStore store, WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var body = request.Body.Trim();
        if (body.Length is < 1 or > 10_000)
            return Validation(nameof(request.Body), "Le message doit contenir entre 1 et 10 000 caractères.");
        if (body.Any(character => char.IsControl(character)
                && character is not '\n' and not '\r' and not '\t'))
            return Validation(nameof(request.Body), "Le message contient un caractère de contrôle.");
        var resourceIds = (request.ResourceIds ?? []).Distinct().Take(20).ToArray();
        if ((request.ResourceIds?.Count ?? 0) > 20)
            return Validation(nameof(request.ResourceIds), "Un message accepte au plus 20 fichiers.");
        var mentionIds = (request.MentionedUserIds ?? []).Distinct().Take(50).ToArray();
        var user = context.GetUser()!;
        var message = await store.CreateMessageAsync(
            user.OrganizationId, channelId, user.UserId, body, resourceIds,
            mentionIds, cancellationToken);
        if (message is null) return Results.NotFound();
        events.Publish(user.OrganizationId, "chat.message_created", message.Id);
        return Results.Created(
            $"/api/v1/chat/channels/{channelId}/messages/{message.Id}", message);
    }
}
