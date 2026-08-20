using System.Buffers.Binary;
using System.Text;

namespace CyTask.Api.Media;

public static class MediaInspector
{
    public const int PrefixBytes = 32;

    private const int MaxParts = 4096;

    public static string DetectContentType(ReadOnlySpan<byte> prefix)
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

        return MediaInspection.GenericContentType;
    }

    public static async Task<MediaInspection> InspectAsync(
        Stream content,
        string declaredContentType,
        MediaLimits limits,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(content);
        if (!content.CanSeek)
        {
            throw new ArgumentException("Inspection requires a seekable stream.", nameof(content));
        }

        var length = content.Length;
        if (length <= 0)
        {
            return MediaInspection.Rejected("Le fichier est vide.");
        }

        var prefix = new byte[PrefixBytes];
        content.Position = 0;
        var prefixLength = await content.ReadAtLeastAsync(
            prefix, Math.Min(PrefixBytes, (int)Math.Min(length, PrefixBytes)), false, cancellationToken);

        var inspection = DetectContentType(prefix.AsSpan(0, prefixLength)) switch
        {
            "image/png" => await InspectPngAsync(content, length, limits, cancellationToken),
            "image/jpeg" => await InspectJpegAsync(content, length, limits, cancellationToken),
            "image/gif" => await InspectGifAsync(content, length, limits, cancellationToken),
            "image/webp" => await InspectWebPAsync(content, length, limits, cancellationToken),
            "video/mp4" => await InspectMp4Async(content, length, cancellationToken),
            "video/webm" => await InspectMatroskaAsync(content, length, cancellationToken),
            _ => MediaInspection.Accept(MediaInspection.GenericContentType)
        };

        return inspection.Accepted ? Reconcile(declaredContentType, inspection) : inspection;
    }

    private static MediaInspection Reconcile(string declaredContentType, MediaInspection inspection)
    {
        var declared = declaredContentType.Trim().ToLowerInvariant();
        if (inspection.ContentType == MediaInspection.GenericContentType)
        {
            return declared.StartsWith("image/", StringComparison.Ordinal) ||
                   declared.StartsWith("video/", StringComparison.Ordinal)
                ? MediaInspection.Rejected("Le contenu n’est pas le média annoncé au dépôt.")
                : inspection;
        }

        return string.Equals(declared, inspection.ContentType, StringComparison.Ordinal)
            ? inspection
            : MediaInspection.Rejected(
                $"Le contenu est un {inspection.ContentType} alors que {declared} était annoncé.");
    }

    private static MediaInspection Sized(string contentType, long width, long height, MediaLimits limits)
    {
        if (width < 1 || height < 1)
        {
            return MediaInspection.Rejected("Les dimensions déclarées par le média sont invalides.");
        }

        if (width > limits.MaxDimension || height > limits.MaxDimension)
        {
            return MediaInspection.Rejected(
                $"Les dimensions dépassent la limite de {limits.MaxDimension} pixels par côté.");
        }

        if (width * height > limits.MaxPixels)
        {
            return MediaInspection.Rejected(
                $"La surface dépasse la limite de {limits.MaxPixels / 1_000_000} mégapixels.");
        }

        return MediaInspection.Accept(contentType, (int)width, (int)height);
    }

    private static async Task<MediaInspection> InspectPngAsync(
        Stream content, long length, MediaLimits limits, CancellationToken cancellationToken)
    {
        var chunkHeader = new byte[8];
        var imageHeader = new byte[13];
        long position = 8;
        long width = 0;
        long height = 0;
        var chunks = 0;
        while (position < length)
        {
            if (!await TryReadAtAsync(content, position, chunkHeader, cancellationToken))
            {
                return MediaInspection.Rejected("Le fichier PNG est tronqué.");
            }

            var dataLength = BinaryPrimitives.ReadUInt32BigEndian(chunkHeader);
            var type = Encoding.ASCII.GetString(chunkHeader, 4, 4);
            if (dataLength > int.MaxValue || !IsLetters(type))
            {
                return MediaInspection.Rejected("Le fichier PNG contient un segment illisible.");
            }

            var next = position + 8L + dataLength + 4L;
            if (next > length)
            {
                return MediaInspection.Rejected("Le fichier PNG est tronqué.");
            }

            if (chunks == 0)
            {
                if (type != "IHDR" || dataLength != 13 ||
                    !await TryReadAtAsync(content, position + 8, imageHeader, cancellationToken))
                {
                    return MediaInspection.Rejected("L’en-tête PNG est absent ou invalide.");
                }

                width = BinaryPrimitives.ReadUInt32BigEndian(imageHeader);
                height = BinaryPrimitives.ReadUInt32BigEndian(imageHeader.AsSpan(4));
            }

            if (type == "IEND")
            {
                return next == length
                    ? Sized("image/png", width, height, limits)
                    : MediaInspection.Rejected("Le fichier PNG contient des données après sa fin.");
            }

            position = next;
            if (++chunks > MaxParts)
            {
                return MediaInspection.Rejected("Le fichier PNG contient trop de segments.");
            }
        }

        return MediaInspection.Rejected("Le fichier PNG n’a pas de marqueur de fin.");
    }

    private static async Task<MediaInspection> InspectJpegAsync(
        Stream content, long length, MediaLimits limits, CancellationToken cancellationToken)
    {
        var marker = new byte[2];
        var frame = new byte[5];
        long position = 2;
        long width = 0;
        long height = 0;
        var segments = 0;
        while (position < length)
        {
            if (!await TryReadAtAsync(content, position, marker, cancellationToken))
            {
                return MediaInspection.Rejected("Le fichier JPEG est tronqué.");
            }

            if (marker[0] != 0xFF)
            {
                return MediaInspection.Rejected("Le fichier JPEG contient un marqueur invalide.");
            }

            var code = marker[1];
            if (code == 0xFF)
            {
                position++;
                continue;
            }

            if (code == 0xD9)
            {
                break;
            }

            if (code == 0x01 || code is >= 0xD0 and <= 0xD7)
            {
                position += 2;
                continue;
            }

            if (!await TryReadAtAsync(content, position + 2, marker, cancellationToken))
            {
                return MediaInspection.Rejected("Le fichier JPEG est tronqué.");
            }

            var segmentLength = (long)BinaryPrimitives.ReadUInt16BigEndian(marker);
            if (segmentLength < 2 || position + 2 + segmentLength > length)
            {
                return MediaInspection.Rejected("Le fichier JPEG contient un segment invalide.");
            }

            if (IsStartOfFrame(code))
            {
                if (segmentLength < 7 || !await TryReadAtAsync(content, position + 4, frame, cancellationToken))
                {
                    return MediaInspection.Rejected("L’en-tête d’image JPEG est invalide.");
                }

                height = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(1));
                width = BinaryPrimitives.ReadUInt16BigEndian(frame.AsSpan(3));
            }

            if (code == 0xDA)
            {
                if (!await TryReadAtAsync(content, length - 2, marker, cancellationToken) ||
                    marker[0] != 0xFF || marker[1] != 0xD9)
                {
                    return MediaInspection.Rejected("Le fichier JPEG n’a pas de marqueur de fin.");
                }

                break;
            }

            position += 2 + segmentLength;
            if (++segments > MaxParts)
            {
                return MediaInspection.Rejected("Le fichier JPEG contient trop de segments.");
            }
        }

        return width == 0 || height == 0
            ? MediaInspection.Rejected("Les dimensions du fichier JPEG sont absentes.")
            : Sized("image/jpeg", width, height, limits);
    }

    private static async Task<MediaInspection> InspectGifAsync(
        Stream content, long length, MediaLimits limits, CancellationToken cancellationToken)
    {
        var header = new byte[10];
        var trailer = new byte[1];
        if (!await TryReadAtAsync(content, 0, header, cancellationToken) ||
            !await TryReadAtAsync(content, length - 1, trailer, cancellationToken))
        {
            return MediaInspection.Rejected("Le fichier GIF est tronqué.");
        }

        if (trailer[0] != 0x3B)
        {
            return MediaInspection.Rejected("Le fichier GIF n’a pas de marqueur de fin.");
        }

        return Sized(
            "image/gif",
            BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(6)),
            BinaryPrimitives.ReadUInt16LittleEndian(header.AsSpan(8)),
            limits);
    }

    private static async Task<MediaInspection> InspectWebPAsync(
        Stream content, long length, MediaLimits limits, CancellationToken cancellationToken)
    {
        var header = new byte[12];
        if (!await TryReadAtAsync(content, 0, header, cancellationToken))
        {
            return MediaInspection.Rejected("Le fichier WebP est tronqué.");
        }

        if (BinaryPrimitives.ReadUInt32LittleEndian(header.AsSpan(4)) + 8L != length)
        {
            return MediaInspection.Rejected("La taille annoncée par l’en-tête RIFF ne correspond pas au fichier.");
        }

        var chunkHeader = new byte[8];
        var payload = new byte[10];
        long position = 12;
        long width = 0;
        long height = 0;
        var canvasIsAuthoritative = false;
        var chunks = 0;
        while (position < length)
        {
            if (!await TryReadAtAsync(content, position, chunkHeader, cancellationToken))
            {
                return MediaInspection.Rejected("Le fichier WebP est tronqué.");
            }

            var fourCc = Encoding.ASCII.GetString(chunkHeader, 0, 4);
            var size = (long)BinaryPrimitives.ReadUInt32LittleEndian(chunkHeader.AsSpan(4));
            var next = position + 8L + size + (size & 1);
            if (next > length)
            {
                return MediaInspection.Rejected("Le fichier WebP est tronqué.");
            }

            var describesImage = fourCc is "VP8X" or "VP8 " or "VP8L" &&
                                 (fourCc == "VP8X" || !canvasIsAuthoritative) &&
                                 size >= (fourCc == "VP8L" ? 5 : 10) &&
                                 await TryReadAtAsync(
                                     content,
                                     position + 8,
                                     payload.AsMemory(0, fourCc == "VP8L" ? 5 : 10),
                                     cancellationToken);
            if (describesImage && fourCc == "VP8X")
            {
                width = ((payload[6] << 16) | (payload[5] << 8) | payload[4]) + 1;
                height = ((payload[9] << 16) | (payload[8] << 8) | payload[7]) + 1;
                canvasIsAuthoritative = true;
            }
            else if (describesImage && fourCc == "VP8 ")
            {
                if (payload[3] != 0x9D || payload[4] != 0x01 || payload[5] != 0x2A)
                {
                    return MediaInspection.Rejected("Le bloc image WebP est invalide.");
                }

                width = BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(6)) & 0x3FFF;
                height = BinaryPrimitives.ReadUInt16LittleEndian(payload.AsSpan(8)) & 0x3FFF;
            }
            else if (describesImage)
            {
                if (payload[0] != 0x2F)
                {
                    return MediaInspection.Rejected("Le bloc image WebP sans perte est invalide.");
                }

                var packed = BinaryPrimitives.ReadUInt32LittleEndian(payload.AsSpan(1));
                width = (packed & 0x3FFF) + 1;
                height = ((packed >> 14) & 0x3FFF) + 1;
            }

            position = next;
            if (++chunks > MaxParts)
            {
                return MediaInspection.Rejected("Le fichier WebP contient trop de segments.");
            }
        }

        return width == 0 || height == 0
            ? MediaInspection.Rejected("Le fichier WebP ne contient pas d’image lisible.")
            : Sized("image/webp", width, height, limits);
    }

    private static async Task<MediaInspection> InspectMp4Async(
        Stream content, long length, CancellationToken cancellationToken)
    {
        var boxHeader = new byte[8];
        long position = 0;
        var sawMovie = false;
        var boxes = 0;
        while (position < length)
        {
            if (!await TryReadAtAsync(content, position, boxHeader, cancellationToken))
            {
                return MediaInspection.Rejected("Le fichier MP4 est tronqué.");
            }

            var size = (long)BinaryPrimitives.ReadUInt32BigEndian(boxHeader);
            var type = Encoding.ASCII.GetString(boxHeader, 4, 4);
            if (!IsPrintable(type))
            {
                return MediaInspection.Rejected("Le fichier MP4 contient une boîte illisible.");
            }

            var headerSize = 8L;
            if (size == 1)
            {
                if (!await TryReadAtAsync(content, position + 8, boxHeader, cancellationToken))
                {
                    return MediaInspection.Rejected("Le fichier MP4 est tronqué.");
                }

                var large = BinaryPrimitives.ReadUInt64BigEndian(boxHeader);
                if (large > long.MaxValue)
                {
                    return MediaInspection.Rejected("Le fichier MP4 déclare une boîte invalide.");
                }

                size = (long)large;
                headerSize = 16;
            }
            else if (size == 0)
            {
                size = length - position;
            }

            if (size < headerSize || position + size > length)
            {
                return MediaInspection.Rejected("Le fichier MP4 contient une boîte tronquée.");
            }

            if (boxes == 0 && type != "ftyp")
            {
                return MediaInspection.Rejected("Le fichier MP4 ne commence pas par un en-tête ftyp.");
            }

            sawMovie |= type == "moov";
            position += size;
            if (++boxes > MaxParts)
            {
                return MediaInspection.Rejected("Le fichier MP4 contient trop de boîtes.");
            }
        }

        return sawMovie
            ? MediaInspection.Accept("video/mp4")
            : MediaInspection.Rejected("Le fichier MP4 ne contient pas d’index moov lisible.");
    }

    private static async Task<MediaInspection> InspectMatroskaAsync(
        Stream content, long length, CancellationToken cancellationToken)
    {
        var element = await ReadEbmlElementAsync(content, 0, length, cancellationToken);
        if (element is not { Id: 0x1A45DFA3, Size: >= 0 })
        {
            return MediaInspection.Rejected("L’en-tête EBML du fichier WebM est invalide.");
        }

        var segment = await ReadEbmlElementAsync(
            content, element.End, length, cancellationToken);
        if (segment is not { Id: 0x18538067 })
        {
            return MediaInspection.Rejected("Le fichier WebM ne contient pas de segment lisible.");
        }

        return segment.Size >= 0 && segment.End > length
            ? MediaInspection.Rejected("Le segment WebM est tronqué.")
            : MediaInspection.Accept("video/webm");
    }

    private sealed record EbmlElement(uint Id, long Size, long End);

    private static async Task<EbmlElement?> ReadEbmlElementAsync(
        Stream content, long position, long length, CancellationToken cancellationToken)
    {
        var buffer = new byte[8];
        if (!await TryReadAtAsync(content, position, buffer.AsMemory(0, 1), cancellationToken))
        {
            return null;
        }

        var idLength = VintLength(buffer[0]);
        if (idLength is 0 or > 4 ||
            !await TryReadAtAsync(content, position, buffer.AsMemory(0, idLength), cancellationToken))
        {
            return null;
        }

        uint id = 0;
        for (var index = 0; index < idLength; index++)
        {
            id = (id << 8) | buffer[index];
        }

        var sizePosition = position + idLength;
        if (!await TryReadAtAsync(content, sizePosition, buffer.AsMemory(0, 1), cancellationToken))
        {
            return null;
        }

        var sizeLength = VintLength(buffer[0]);
        if (sizeLength == 0 ||
            !await TryReadAtAsync(content, sizePosition, buffer.AsMemory(0, sizeLength), cancellationToken))
        {
            return null;
        }

        long size = buffer[0] & (0xFF >> sizeLength);
        var unknown = size == (0xFF >> sizeLength);
        for (var index = 1; index < sizeLength; index++)
        {
            size = (size << 8) | buffer[index];
            unknown &= buffer[index] == 0xFF;
        }

        var headerEnd = sizePosition + sizeLength;
        return unknown
            ? new EbmlElement(id, -1, headerEnd)
            : new EbmlElement(id, size, Math.Min(headerEnd + size, length + 1));
    }

    private static int VintLength(byte first)
    {
        for (var index = 0; index < 8; index++)
        {
            if ((first & (0x80 >> index)) != 0)
            {
                return index + 1;
            }
        }

        return 0;
    }

    private static async Task<bool> TryReadAtAsync(
        Stream content, long position, Memory<byte> buffer, CancellationToken cancellationToken)
    {
        if (position < 0 || position + buffer.Length > content.Length)
        {
            return false;
        }

        content.Position = position;
        await content.ReadExactlyAsync(buffer, cancellationToken);
        return true;
    }

    private static bool IsStartOfFrame(byte code) =>
        code is >= 0xC0 and <= 0xCF && code is not (0xC4 or 0xC8 or 0xCC);

    private static bool IsLetters(string value) => value.All(char.IsAsciiLetter);

    private static bool IsPrintable(string value) => value.All(character => character is >= ' ' and <= '~');
}
