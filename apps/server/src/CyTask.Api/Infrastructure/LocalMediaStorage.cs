using System.Buffers;
using System.Security.Cryptography;
using CyTask.Api.Domain;
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
        Directory.CreateDirectory(_uploadsPath);
        Directory.CreateDirectory(_quarantinePath);
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
        var prefix = new byte[32];
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

    public void DeleteQuarantined(Guid organizationId, Guid attachmentId)
    {
        var directory = Path.Combine(_quarantinePath, organizationId.ToString("N"));
        File.Delete(Path.Combine(directory, $"{attachmentId:N}.blob"));
    }

    private string UploadDirectory(Guid organizationId, Guid uploadId) =>
        Path.Combine(_uploadsPath, organizationId.ToString("N"), uploadId.ToString("N"));

    private static string ChunkPath(string directory, int index) =>
        Path.Combine(directory, $"{index:D8}.chunk");

    private static string DetectContentType(ReadOnlySpan<byte> prefix)
    {
        if (prefix.StartsWith(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return "image/png";
        }

        if (prefix.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }))
        {
            return "image/jpeg";
        }

        if (prefix.StartsWith("GIF87a"u8) || prefix.StartsWith("GIF89a"u8))
        {
            return "image/gif";
        }

        if (prefix.Length >= 12 && prefix[..4].SequenceEqual("RIFF"u8) && prefix[8..12].SequenceEqual("WEBP"u8))
        {
            return "image/webp";
        }

        if (prefix.Length >= 12 && prefix[4..8].SequenceEqual("ftyp"u8))
        {
            return "video/mp4";
        }

        if (prefix.StartsWith(new byte[] { 0x1A, 0x45, 0xDF, 0xA3 }))
        {
            return "video/webm";
        }

        return "application/octet-stream";
    }
}
