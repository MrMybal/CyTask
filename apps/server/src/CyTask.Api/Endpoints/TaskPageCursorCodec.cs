using System.Globalization;
using System.Text;
using System.Text.Json;
using CyTask.Api.Domain;
using Microsoft.AspNetCore.WebUtilities;

namespace CyTask.Api.Endpoints;

internal static class TaskPageCursorCodec
{
    private const int MaxCursorLength = 1024;

    public static string Encode(WorkItem task, string sort)
    {
        var payload = sort switch
        {
            "updated" => new CursorPayload(1, sort, task.Id, task.UpdatedAt.ToString("O", CultureInfo.InvariantCulture), null, null, false),
            "created" => new CursorPayload(1, sort, task.Id, task.CreatedAt.ToString("O", CultureInfo.InvariantCulture), null, null, false),
            "due" => new CursorPayload(
                1,
                sort,
                task.Id,
                task.DueAt?.ToString("O", CultureInfo.InvariantCulture),
                null,
                null,
                task.DueAt is null),
            "key" => new CursorPayload(1, sort, task.Id, null, null, task.Number, false),
            "title" => new CursorPayload(1, sort, task.Id, null, task.Title, null, false),
            _ => throw new ArgumentOutOfRangeException(nameof(sort))
        };
        return WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload)));
    }

    public static bool TryDecode(string cursor, string expectedSort, out TaskPageCursor? result)
    {
        result = null;
        if (cursor.Length is < 1 or > MaxCursorLength)
        {
            return false;
        }

        try
        {
            var payload = JsonSerializer.Deserialize<CursorPayload>(
                WebEncoders.Base64UrlDecode(cursor));
            if (payload is null
                || payload.Version != 1
                || payload.Sort != expectedSort
                || payload.TaskId == Guid.Empty)
            {
                return false;
            }

            DateTimeOffset? timestamp = null;
            if (payload.Value is not null)
            {
                if (!DateTimeOffset.TryParseExact(
                        payload.Value,
                        "O",
                        CultureInfo.InvariantCulture,
                        DateTimeStyles.RoundtripKind,
                        out var parsedTimestamp))
                {
                    return false;
                }

                timestamp = parsedTimestamp;
            }

            var valid = expectedSort switch
            {
                "updated" or "created" => timestamp is not null
                    && payload.Text is null && payload.Number is null && !payload.IsNull,
                "due" => payload.IsNull
                    ? payload.Value is null && payload.Text is null && payload.Number is null
                    : timestamp is not null && payload.Text is null && payload.Number is null,
                "key" => payload.Number is >= 1
                    && payload.Value is null && payload.Text is null && !payload.IsNull,
                "title" => payload.Text is { Length: >= 1 and <= 240 }
                    && payload.Value is null && payload.Number is null && !payload.IsNull,
                _ => false
            };
            if (!valid)
            {
                return false;
            }

            result = new TaskPageCursor(
                payload.TaskId,
                timestamp,
                payload.Text,
                payload.Number,
                payload.IsNull);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
        catch (FormatException)
        {
            return false;
        }
    }

    private sealed record CursorPayload(
        int Version,
        string Sort,
        Guid TaskId,
        string? Value,
        string? Text,
        int? Number,
        bool IsNull);
}
