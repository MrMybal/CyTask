using System.Text;
using CyTask.Api.Configuration;
using CyTask.Api.Infrastructure;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Collaboration;

public static partial class CollaborationEndpoints
{
    private static async Task<IResult> CreateResourceUploadAsync(
        Guid projectId, CreateProjectResourceUploadRequest request, HttpContext context,
        ICollaborationStore store, IOptions<CyTaskOptions> options,
        CancellationToken cancellationToken)
    {
        var name = request.FileName.Trim().Normalize(NormalizationForm.FormC);
        var contentType = request.ContentType.Trim().ToLowerInvariant();
        var sha256 = request.Sha256.Trim().ToLowerInvariant();
        var errors = new Dictionary<string, string[]>();
        if (name.Length is < 1 or > 240 || name.Any(char.IsControl)
            || name.Contains('/') || name.Contains('\\'))
            errors[nameof(request.FileName)] = ["Le nom de fichier est invalide."];
        if (!SessionSecurity.IsValidContentType(contentType))
            errors[nameof(request.ContentType)] = ["Le type de contenu est invalide."];
        if (request.SizeBytes is < 1 || request.SizeBytes > options.Value.MaxAttachmentBytes)
            errors[nameof(request.SizeBytes)] =
                [$"Le fichier doit contenir au plus {options.Value.MaxAttachmentBytes} octets."];
        if (!SessionSecurity.IsValidSha256(sha256))
            errors[nameof(request.Sha256)] = ["L’empreinte SHA-256 est invalide."];
        if (errors.Count > 0) return Results.ValidationProblem(errors);

        var user = context.GetUser()!;
        var upload = await store.CreateResourceUploadAsync(new(
            user.OrganizationId, projectId, request.FolderLabelId, user.UserId, name,
            contentType, request.SizeBytes, sha256, options.Value.UploadChunkBytes,
            DateTimeOffset.UtcNow.AddHours(options.Value.UploadHours)), cancellationToken);
        return upload is null ? Results.NotFound()
            : Results.Created($"/api/v1/resource-uploads/{upload.Id}", upload);
    }

    private static async Task<IResult> GetResourceUploadAsync(
        Guid uploadId, HttpContext context, ICollaborationStore store,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var upload = await store.GetResourceUploadAsync(
            user.OrganizationId, uploadId, cancellationToken);
        return upload is null || upload.Resource.CreatedBy != user.UserId
            ? Results.NotFound() : Results.Ok(upload);
    }

    private static async Task<IResult> UploadResourceChunkAsync(
        Guid uploadId, int index, HttpContext context, ICollaborationStore store,
        LocalMediaStorage storage, CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var request = context.Request;
        var declaredHash = request.Headers["X-Chunk-SHA256"].ToString().Trim().ToLowerInvariant();
        if (index < 0 || !SessionSecurity.IsValidSha256(declaredHash))
            return Validation("chunk", "L’index ou l’empreinte du bloc est invalide.");
        if (!string.Equals(request.ContentType, "application/octet-stream",
                StringComparison.OrdinalIgnoreCase))
            return Results.Problem(statusCode: 415, title: "Les blocs doivent être binaires.");

        var upload = await store.GetResourceUploadAsync(
            user.OrganizationId, uploadId, cancellationToken);
        if (upload is null || upload.Resource.CreatedBy != user.UserId) return Results.NotFound();
        var existing = upload.Chunks.SingleOrDefault(chunk => chunk.Index == index);
        if (existing is not null)
            return existing.Sha256 == declaredHash && existing.SizeBytes == request.ContentLength
                ? Results.Ok(existing) : Results.Conflict();

        var received = upload.Chunks.Sum(chunk => chunk.SizeBytes);
        var expected = Math.Min(upload.ChunkSizeBytes, upload.Resource.SizeBytes - received);
        if (index != upload.Chunks.Count || request.ContentLength != expected || expected <= 0)
            return Results.Problem(statusCode: 409, title: "Bloc inattendu ou taille incorrecte.");

        StoredChunk stored;
        try
        {
            stored = await storage.WriteChunkAsync(
                user.OrganizationId, uploadId, index, request.Body, expected, cancellationToken);
        }
        catch (MediaStorageLimitException exception)
        {
            return Results.Problem(statusCode: 413, title: exception.Message);
        }
        catch (MediaStorageConflictException exception)
        {
            return Results.Problem(statusCode: 409, title: exception.Message);
        }
        if (stored.SizeBytes != expected || stored.Sha256 != declaredHash)
        {
            storage.DeleteChunk(user.OrganizationId, uploadId, index);
            return Results.Problem(statusCode: 422, title: "L’empreinte du bloc ne correspond pas.");
        }
        var result = await store.RecordResourceChunkAsync(
            user.OrganizationId, uploadId, index, stored.SizeBytes, stored.Sha256,
            cancellationToken);
        if (result.Status is ResourceChunkStatus.Conflict or ResourceChunkStatus.NotFound)
        {
            storage.DeleteChunk(user.OrganizationId, uploadId, index);
            return result.Status == ResourceChunkStatus.NotFound
                ? Results.NotFound() : Results.Conflict();
        }
        return Results.Ok(result.Chunk);
    }
}
