namespace CyTask.Api.Media;

public sealed record MediaInspection(
    bool Accepted,
    string ContentType,
    int? Width,
    int? Height,
    string? RejectionReason,
    double? DurationSeconds = null)
{
    public const string GenericContentType = "application/octet-stream";

    public static MediaInspection Rejected(string reason) =>
        new(false, GenericContentType, null, null, reason);

    public static MediaInspection Accept(
        string contentType, int? width = null, int? height = null, double? durationSeconds = null) =>
        new(true, contentType, width, height, null, durationSeconds);
}

public sealed record MediaLimits(int MaxDimension, long MaxPixels);
