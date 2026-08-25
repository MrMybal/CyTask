using System.Buffers;
using System.Security.Cryptography;
using CyTask.Api.Collaboration;
using CyTask.Api.Domain;
using CyTask.Api.Media;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Infrastructure;

public sealed record StoredChunk(long SizeBytes, string Sha256);

public sealed record AssembledBlob(long SizeBytes, string Sha256, string DetectedContentType);

public sealed class MediaStorageLimitException(string message) : Exception(message);

public sealed class MediaStorageConflictException(string message) : Exception(message);

public sealed class LocalMediaStorage
{
    private readonly string _uploadsPath;
    private readonly string _quarantinePath;
    private readonly string _objectsPath;

    public LocalMediaStorage(IOptions<Configuration.CyTaskOptions> options, IHostEnvironment environment)
    {
        var configured = options.Value.MediaStoragePath;
        var root = Path.GetFullPath(Path.IsPathRooted(configured)
            ? configured
            : Path.Combine(environment.ContentRootPath, configured));
        var webRoot = Path.GetFullPath(Path.Combine(environment.ContentRootPath, "wwwroot"));
        if (root.Equals(webRoot, StringComparison.OrdinalIgnoreCase) ||
            root.StartsWith($"{webRoot}{Path.DirectorySeparatorChar}", StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("MediaStoragePath must be outside the public Web root.");
        }

        _uploadsPath = Path.Combine(root, "uploads");
        _quarantinePath = Path.Combine(root, "quarantine");
        _objectsPath = Path.Combine(root, "objects");
        Directory.CreateDirectory(_uploadsPath);
        Directory.CreateDirectory(_quarantinePath);
        Directory.CreateDirectory(_objectsPath);
    }

    public async Task<StoredChunk> WriteChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        Stream source,
        long maximumBytes,
        CancellationToken cancellationToken)
    {
        var directory = UploadDirectory(organizationId, uploadId);
        Directory.CreateDirectory(directory);
        var finalPath = ChunkPath(directory, index);
        var partialPath = $"{finalPath}.{Guid.NewGuid():N}.partial";
        if (File.Exists(finalPath))
        {
            throw new MediaStorageConflictException("This chunk is already being uploaded.");
        }

        long total = 0;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            await using (var target = new FileStream(
                             partialPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             buffer.Length,
                             FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                int read;
                while ((read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) > 0)
                {
                    total += read;
                    if (total > maximumBytes)
                    {
                        throw new MediaStorageLimitException("The chunk exceeds the configured size limit.");
                    }

                    hash.AppendData(buffer, 0, read);
                    await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }

                if (total == 0)
                {
                    throw new MediaStorageLimitException("Empty chunks are not accepted.");
                }

                await target.FlushAsync(cancellationToken);
            }

            File.Move(partialPath, finalPath);
            return new StoredChunk(total, Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
        }
        catch (IOException) when (File.Exists(finalPath))
        {
            File.Delete(partialPath);
            throw new MediaStorageConflictException("This chunk has already been stored.");
        }
        catch
        {
            File.Delete(partialPath);
            throw;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    public Task<AssembledBlob> AssembleResourceInQuarantineAsync(
        Guid organizationId,
        ProjectResourceUpload upload,
        CancellationToken cancellationToken)
    {
        var resource = upload.Resource;
        var attachment = new Attachment(
            resource.Id, resource.OrganizationId, Guid.Empty, resource.Name,
            resource.DeclaredContentType ?? MediaInspection.GenericContentType, null,
            resource.SizeBytes, resource.Sha256 ?? string.Empty, resource.Status, false,
            resource.CreatedBy, resource.CreatedAt);
        var adapter = new AttachmentUpload(
            upload.Id, attachment, upload.ChunkSizeBytes, upload.ExpiresAt, upload.Status,
            upload.Chunks.Select(chunk => new UploadChunk(
                chunk.Index, chunk.SizeBytes, chunk.Sha256, chunk.CreatedAt)).ToArray());
        return AssembleInQuarantineAsync(organizationId, adapter, cancellationToken);
    }

    public async Task<AssembledBlob> AssembleInQuarantineAsync(
        Guid organizationId,
        AttachmentUpload upload,
        CancellationToken cancellationToken)
    {
        var uploadDirectory = UploadDirectory(organizationId, upload.Id);
        var organizationUploadDirectory = Path.GetDirectoryName(uploadDirectory)!;
        Directory.CreateDirectory(organizationUploadDirectory);
        var lockPath = Path.Combine(organizationUploadDirectory, $"{upload.Id:N}.assemble.lock");
        FileStream assemblyLock;
        try
        {
            assemblyLock = new FileStream(
                lockPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.Asynchronous);
        }
        catch (IOException) when (File.Exists(lockPath))
        {
            throw new MediaStorageConflictException("The attachment is already being assembled.");
        }

        try
        {
            return await AssembleCoreAsync(
                organizationId, upload, uploadDirectory, cancellationToken);
        }
        finally
        {
            await assemblyLock.DisposeAsync();
            File.Delete(lockPath);
        }
    }

    private async Task<AssembledBlob> AssembleCoreAsync(
        Guid organizationId,
        AttachmentUpload upload,
        string uploadDirectory,
        CancellationToken cancellationToken)
    {
        var quarantineDirectory = Path.Combine(_quarantinePath, organizationId.ToString("N"));
        Directory.CreateDirectory(quarantineDirectory);
        var finalPath = Path.Combine(quarantineDirectory, $"{upload.Attachment.Id:N}.blob");
        var partialPath = $"{finalPath}.{Guid.NewGuid():N}.partial";
        if (File.Exists(finalPath))
        {
            throw new MediaStorageConflictException("The attachment has already been assembled.");
        }

        long total = 0;
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var prefix = new byte[MediaInspector.PrefixBytes];
        var prefixLength = 0;
        var buffer = ArrayPool<byte>.Shared.Rent(64 * 1024);
        try
        {
            await using (var target = new FileStream(
                             partialPath,
                             FileMode.CreateNew,
                             FileAccess.Write,
                             FileShare.None,
                             buffer.Length,
                             FileOptions.Asynchronous | FileOptions.SequentialScan))
            {
                foreach (var chunk in upload.Chunks.OrderBy(chunk => chunk.Index))
                {
                    var path = ChunkPath(uploadDirectory, chunk.Index);
                    await using var source = new FileStream(
                        path,
                        FileMode.Open,
                        FileAccess.Read,
                        FileShare.Read,
                        buffer.Length,
                        FileOptions.Asynchronous | FileOptions.SequentialScan);
                    int read;
                    long chunkTotal = 0;
                    while ((read = await source.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken)) > 0)
                    {
                        if (prefixLength < prefix.Length)
                        {
                            var copied = Math.Min(read, prefix.Length - prefixLength);
                            buffer.AsSpan(0, copied).CopyTo(prefix.AsSpan(prefixLength));
                            prefixLength += copied;
                        }

                        total += read;
                        chunkTotal += read;
                        hash.AppendData(buffer, 0, read);
                        await target.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                    }

                    if (chunkTotal != chunk.SizeBytes)
                    {
                        throw new InvalidDataException("A stored chunk does not match its recorded size.");
                    }
                }

                await target.FlushAsync(cancellationToken);
            }

            var sha256 = Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
            if (total != upload.Attachment.SizeBytes ||
                !string.Equals(sha256, upload.Attachment.Sha256, StringComparison.Ordinal))
            {
                throw new InvalidDataException("The assembled attachment does not match its declared fingerprint.");
            }

            File.Move(partialPath, finalPath);
            Directory.Delete(uploadDirectory, recursive: true);
            return new AssembledBlob(total, sha256, DetectContentType(prefix.AsSpan(0, prefixLength)));
        }
        catch (IOException) when (File.Exists(finalPath))
        {
            File.Delete(partialPath);
            throw new MediaStorageConflictException("The attachment has already been assembled.");
        }
        catch
        {
            File.Delete(partialPath);
            throw;
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    public void DeleteUpload(Guid organizationId, Guid uploadId)
    {
        var directory = UploadDirectory(organizationId, uploadId);
        if (Directory.Exists(directory))
        {
            Directory.Delete(directory, recursive: true);
        }
    }

    public void DeleteChunk(Guid organizationId, Guid uploadId, int index)
    {
        var directory = UploadDirectory(organizationId, uploadId);
        File.Delete(ChunkPath(directory, index));
    }

    public void DeleteQuarantined(Guid organizationId, Guid attachmentId) =>
        File.Delete(QuarantinePath(organizationId, attachmentId));

    public void DeleteObject(Guid organizationId, Guid attachmentId) =>
        File.Delete(ObjectPath(organizationId, attachmentId));

    public Stream? OpenObject(Guid organizationId, Guid attachmentId) =>
        OpenRead(ObjectPath(organizationId, attachmentId));

    public Stream? OpenForReview(Guid organizationId, Guid attachmentId) =>
        OpenRead(QuarantinePath(organizationId, attachmentId)) ??
        OpenRead(ObjectPath(organizationId, attachmentId));

    public void Promote(Guid organizationId, Guid attachmentId)
    {
        var source = QuarantinePath(organizationId, attachmentId);
        var target = ObjectPath(organizationId, attachmentId);
        if (!File.Exists(source) && File.Exists(target))
        {
            return;
        }

        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Move(source, target, overwrite: true);
    }

    private static FileStream? OpenRead(string path)
    {
        try
        {
            return new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.SequentialScan);
        }
        catch (Exception exception) when (
            exception is FileNotFoundException or DirectoryNotFoundException)
        {
            return null;
        }
    }

    private string QuarantinePath(Guid organizationId, Guid attachmentId) =>
        Path.Combine(_quarantinePath, organizationId.ToString("N"), $"{attachmentId:N}.blob");

    private string ObjectPath(Guid organizationId, Guid attachmentId) =>
        Path.Combine(_objectsPath, organizationId.ToString("N"), $"{attachmentId:N}.blob");

    private string UploadDirectory(Guid organizationId, Guid uploadId) =>
        Path.Combine(_uploadsPath, organizationId.ToString("N"), uploadId.ToString("N"));

    private static string ChunkPath(string directory, int index) =>
        Path.Combine(directory, $"{index:D8}.chunk");

    private static string DetectContentType(ReadOnlySpan<byte> prefix) =>
        MediaInspector.DetectContentType(prefix);
}
