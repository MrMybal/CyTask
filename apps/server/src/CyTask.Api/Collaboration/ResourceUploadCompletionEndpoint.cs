using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Media;
using CyTask.Api.Realtime;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task<IResult> CompleteResourceUploadAsync(
        Guid uploadId, HttpContext context, ICollaborationStore store,
        LocalMediaStorage storage, WorkspaceEventHub events,
        IOptions<CyTaskOptions> options, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var upload = await store.GetResourceUploadAsync(
            user.OrganizationId, uploadId, cancellationToken);
        if (upload is null || upload.Resource.CreatedBy != user.UserId) return Results.NotFound();
        if (upload.Chunks.Sum(chunk => chunk.SizeBytes) != upload.Resource.SizeBytes)
            return Results.Problem(statusCode: 409, title: "L’envoi est incomplet.");

        try
        {
            await storage.AssembleResourceInQuarantineAsync(
                user.OrganizationId, upload, cancellationToken);
        }
        catch (MediaStorageConflictException exception)
        {
            return Results.Problem(statusCode: 409, title: exception.Message);
        }
        catch (Exception exception) when (
            exception is InvalidDataException or FileNotFoundException or DirectoryNotFoundException)
        {
            await store.RejectResourceUploadAsync(
                user.OrganizationId, uploadId, "Empreinte ou blocs invalides.", cancellationToken);
            storage.DeleteUpload(user.OrganizationId, uploadId);
            return Results.Problem(statusCode: 422, title: "Le fichier assemblé est invalide.");
        }

        var reviewStream = storage.OpenForReview(user.OrganizationId, upload.Resource.Id);
        if (reviewStream is null) return Results.NotFound();
        MediaInspection inspection;
        await using (reviewStream)
        {
            inspection = await MediaInspector.InspectAsync(
                reviewStream, upload.Resource.DeclaredContentType ?? "application/octet-stream",
                new(options.Value.MaxMediaDimension, options.Value.MaxMediaPixels),
                cancellationToken);
        }

        if (!inspection.Accepted)
        {
            await store.RejectResourceUploadAsync(
                user.OrganizationId, uploadId, inspection.RejectionReason ?? "Fichier refusé.",
                cancellationToken);
            storage.DeleteQuarantined(user.OrganizationId, upload.Resource.Id);
            events.Publish(user.OrganizationId, "project.resource_rejected", upload.Resource.Id);
            return Results.Problem(statusCode: 422, title: inspection.RejectionReason);
        }

        storage.Promote(user.OrganizationId, upload.Resource.Id);
        var resource = await store.CompleteResourceUploadAsync(
            user.OrganizationId, uploadId, inspection.ContentType, cancellationToken);
        if (resource is null)
        {
            storage.DeleteObject(user.OrganizationId, upload.Resource.Id);
            return Results.Conflict();
        }
        events.Publish(user.OrganizationId, "project.resource_available", resource.Id);
        return Results.Ok(resource);
    }
}
