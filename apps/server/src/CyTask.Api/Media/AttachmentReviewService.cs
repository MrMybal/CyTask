using CyTask.Api.Configuration;
using CyTask.Api.Domain;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Media;

public sealed class AttachmentReviewService(
    IServiceScopeFactory scopeFactory,
    LocalMediaStorage storage,
    WorkspaceEventHub events,
    IOptions<CyTaskOptions> options,
    ILogger<AttachmentReviewService> logger) : BackgroundService
{
    private static readonly Action<ILogger, Guid, string, Exception?> LogReviewRejected =
        LoggerMessage.Define<Guid, string>(
            LogLevel.Information,
            new EventId(2001, nameof(ReviewAsync)),
            "Attachment {AttachmentId} rejected: {Reason}");

    private static readonly Action<ILogger, Guid, Exception?> LogReviewFailed =
        LoggerMessage.Define<Guid>(
            LogLevel.Warning,
            new EventId(2002, nameof(ReviewAsync)),
            "Attachment {AttachmentId} could not be reviewed");

    private static readonly Action<ILogger, Exception?> LogCycleFailed =
        LoggerMessage.Define(
            LogLevel.Error,
            new EventId(2003, nameof(ExecuteAsync)),
            "The attachment review cycle failed");

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.Value.MediaReviewSeconds));
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                while (await ReviewBatchAsync(stoppingToken) > 0)
                {
                }
            }
            catch (OperationCanceledException)
            {
                return;
            }
            catch (Exception exception) when (exception is IOException or InvalidOperationException)
            {
                LogCycleFailed(logger, exception);
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false))
            {
                return;
            }
        }
    }

    public async Task<int> ReviewBatchAsync(CancellationToken cancellationToken)
    {
        using var scope = scopeFactory.CreateScope();
        var store = scope.ServiceProvider.GetRequiredService<IWorkspaceStore>();
        var pending = await store.ClaimAttachmentsForReviewAsync(
            options.Value.MediaReviewBatch,
            DateTimeOffset.UtcNow.AddMinutes(5),
            cancellationToken);
        foreach (var candidate in pending)
        {
            await ReviewAsync(store, candidate, cancellationToken);
        }

        return pending.Count;
    }

    private async Task ReviewAsync(
        IWorkspaceStore store,
        PendingAttachmentReview candidate,
        CancellationToken cancellationToken)
    {
        var review = await InspectAsync(candidate, cancellationToken);
        if (review.Accepted)
        {
            storage.Promote(candidate.OrganizationId, candidate.Id);
        }

        var attachment = await store.ApplyAttachmentReviewAsync(
            candidate.OrganizationId, candidate.Id, review, DateTimeOffset.UtcNow, cancellationToken);
        if (attachment is null)
        {
            return;
        }

        if (review.Accepted)
        {
            events.Publish(candidate.OrganizationId, "attachment.available", candidate.Id);
            return;
        }

        LogReviewRejected(logger, candidate.Id, review.RejectionReason ?? "unknown", null);
        DeleteQuarantined(candidate);
        events.Publish(candidate.OrganizationId, "attachment.rejected", candidate.Id);
    }

    private async Task<AttachmentReview> InspectAsync(
        PendingAttachmentReview candidate,
        CancellationToken cancellationToken)
    {
        if (candidate.Attempts > options.Value.MediaReviewAttempts)
        {
            return Refuse("L’analyse du fichier n’a pas abouti après plusieurs tentatives.");
        }

        Stream? content = null;
        try
        {
            content = storage.OpenForReview(candidate.OrganizationId, candidate.Id);
            if (content is null)
            {
                return Refuse("Le fichier mis en quarantaine est introuvable.");
            }

            var inspection = await MediaInspector.InspectAsync(
                content,
                candidate.DeclaredContentType,
                new MediaLimits(options.Value.MaxMediaDimension, options.Value.MaxMediaPixels),
                cancellationToken);
            return new AttachmentReview(
                inspection.Accepted,
                inspection.ContentType,
                inspection.Width,
                inspection.Height,
                inspection.RejectionReason,
                inspection.DurationSeconds);
        }
        catch (IOException)
        {
            LogReviewFailed(logger, candidate.Id, null);
            return Refuse("Le fichier mis en quarantaine est illisible.");
        }
        finally
        {
            if (content is not null)
            {
                await content.DisposeAsync();
            }
        }
    }

    private void DeleteQuarantined(PendingAttachmentReview candidate)
    {
        try
        {
            storage.DeleteQuarantined(candidate.OrganizationId, candidate.Id);
        }
        catch (IOException)
        {
            LogReviewFailed(logger, candidate.Id, null);
        }
    }

    private static AttachmentReview Refuse(string reason) =>
        new(false, MediaInspection.GenericContentType, null, null, reason);
}
