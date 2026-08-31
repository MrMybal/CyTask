using System.Globalization;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace CyTask.Api.Migrations;

internal sealed partial class MigrationSourceClient(IHttpClientFactory httpClientFactory)
{
    public async Task<NormalizedMigration> FetchAsync(
        MigrationAnalyzeRequest request,
        CancellationToken cancellationToken)
    {
        var source = request.Source.Trim().ToLowerInvariant();
        return source switch
        {
            "clickup" => await FetchClickUpAsync(request, cancellationToken),
            "jira" => await FetchJiraAsync(request, cancellationToken),
            _ => throw new MigrationSourceException("Only ClickUp and Jira Cloud are supported.")
        };
    }

    private async Task<NormalizedMigration> FetchClickUpAsync(
        MigrationAnalyzeRequest request,
        CancellationToken cancellationToken)
    {
        var token = Required(request.ApiToken, "A ClickUp personal token is required.", 4096);
        var listId = ValidateIdentifier(request.ContainerId, "ClickUp list identifier");
        var client = httpClientFactory.CreateClient("migration");
        using var listRequest = CreateClickUpRequest(HttpMethod.Get, $"https://api.clickup.com/api/v2/list/{Uri.EscapeDataString(listId)}", token);
        using var listDocument = await SendJsonAsync(client, listRequest, "ClickUp list", cancellationToken);
        var listName = GetString(listDocument.RootElement, "name") ?? $"ClickUp {listId}";

        var items = new List<NormalizedMigrationItem>();
        var warnings = new List<string>();
        var page = 0;
        while (items.Count < request.MaxItems)
        {
            var remaining = request.MaxItems - items.Count;
            var url = $"https://api.clickup.com/api/v2/list/{Uri.EscapeDataString(listId)}/task" +
                      $"?archived=false&include_closed={request.IncludeCompleted.ToString().ToLowerInvariant()}" +
                      $"&subtasks=true&page={page}&order_by=created&reverse=false";
            using var pageRequest = CreateClickUpRequest(HttpMethod.Get, url, token);
            using var document = await SendJsonAsync(client, pageRequest, "ClickUp tasks", cancellationToken);
            if (!TryGetArray(document.RootElement, "tasks", out var tasks) || tasks.GetArrayLength() == 0)
            {
                break;
            }

            foreach (var task in tasks.EnumerateArray().Take(remaining))
            {
                items.Add(ParseClickUpTask(task));
            }

            if (tasks.GetArrayLength() < 100)
            {
                break;
            }

            page += 1;
        }

        if (items.Count == request.MaxItems)
        {
            warnings.Add($"The preview was limited to {request.MaxItems} tasks.");
        }

        if (request.IncludeComments && items.Count > 0)
        {
            using var gate = new SemaphoreSlim(4);
            var commentWarnings = new System.Collections.Concurrent.ConcurrentQueue<string>();
            var commentTasks = items.Select(async (item, index) =>
            {
                await gate.WaitAsync(cancellationToken);
                try
                {
                    var url = $"https://api.clickup.com/api/v2/task/{Uri.EscapeDataString(item.SourceId)}/comment";
                    using var commentsRequest = CreateClickUpRequest(HttpMethod.Get, url, token);
                    using var document = await SendJsonAsync(client, commentsRequest, $"comments for {item.SourceKey}", cancellationToken);
                    var comments = ParseClickUpComments(document.RootElement);
                    items[index] = item with { Comments = comments };
                }
                catch (MigrationSourceException)
                {
                    commentWarnings.Enqueue($"Comments could not be read for {item.SourceKey}.");
                }
                finally
                {
                    gate.Release();
                }
            });
            await Task.WhenAll(commentTasks);
            warnings.AddRange(commentWarnings);
        }

        return new NormalizedMigration(
            "clickup",
            Truncate(listName, 120),
            $"list:{listId}",
            items,
            warnings);
    }

    private async Task<NormalizedMigration> FetchJiraAsync(
        MigrationAnalyzeRequest request,
        CancellationToken cancellationToken)
    {
        var token = Required(request.ApiToken, "A Jira API token is required.", 4096);
        var email = Required(request.AccountEmail, "The Jira account email is required.", 320);
        var projectKey = ValidateIdentifier(request.ContainerId.ToUpperInvariant(), "Jira project key");
        var site = ValidateJiraSite(request.SiteUrl);
        var client = httpClientFactory.CreateClient("migration");
        var authorization = Convert.ToBase64String(Encoding.UTF8.GetBytes($"{email}:{token}"));

        using var projectRequest = CreateJiraRequest(
            HttpMethod.Get,
            new Uri(site, $"/rest/api/3/project/{Uri.EscapeDataString(projectKey)}"),
            authorization);
        using var projectDocument = await SendJsonAsync(client, projectRequest, "Jira project", cancellationToken);
        var projectName = GetString(projectDocument.RootElement, "name") ?? projectKey;

        var items = new List<NormalizedMigrationItem>();
        var warnings = new List<string>();
        string? nextPageToken = null;
        do
        {
            var body = new Dictionary<string, object?>
            {
                ["jql"] = $"project = \"{projectKey}\"{(request.IncludeCompleted ? string.Empty : " AND statusCategory != Done")} ORDER BY created ASC",
                ["maxResults"] = Math.Min(100, request.MaxItems - items.Count),
                ["fields"] = new[]
                {
                    "summary", "description", "status", "priority", "assignee", "labels",
                    "duedate", "created", "updated", "parent", "attachment", "comment", "issuelinks"
                }
            };
            if (!string.IsNullOrWhiteSpace(nextPageToken))
            {
                body["nextPageToken"] = nextPageToken;
            }

            using var searchRequest = CreateJiraRequest(
                HttpMethod.Post,
                new Uri(site, "/rest/api/3/search/jql"),
                authorization,
                JsonSerializer.Serialize(body));
            using var document = await SendJsonAsync(client, searchRequest, "Jira issues", cancellationToken);
            if (!TryGetArray(document.RootElement, "issues", out var issues))
            {
                throw new MigrationSourceException("Jira returned an invalid issue search response.");
            }

            foreach (var issue in issues.EnumerateArray())
            {
                if (items.Count >= request.MaxItems)
                {
                    break;
                }

                items.Add(ParseJiraIssue(site, issue, warnings));
            }

            nextPageToken = GetString(document.RootElement, "nextPageToken");
            var isLast = GetBoolean(document.RootElement, "isLast") ?? string.IsNullOrWhiteSpace(nextPageToken);
            if (isLast || issues.GetArrayLength() == 0)
            {
                break;
            }
        }
        while (items.Count < request.MaxItems);

        if (items.Count == request.MaxItems)
        {
            warnings.Add($"The preview was limited to {request.MaxItems} issues.");
        }

        if (!request.IncludeCompleted)
        {
            items = items.Where(item =>
                !item.Status.Contains("done", StringComparison.OrdinalIgnoreCase)
                && !item.Status.Contains("closed", StringComparison.OrdinalIgnoreCase)
                && !item.Status.Contains("resolved", StringComparison.OrdinalIgnoreCase)).ToList();
        }

        if (!request.IncludeComments)
        {
            items = items.Select(item => item with { Comments = [] }).ToList();
        }

        return new NormalizedMigration(
            "jira",
            Truncate(projectName, 120),
            $"project:{site.Host}/{projectKey}",
            items,
            warnings.Distinct(StringComparer.Ordinal).ToArray());
    }

    private static NormalizedMigrationItem ParseClickUpTask(JsonElement task)
    {
        var sourceId = GetString(task, "id") ?? throw new MigrationSourceException("A ClickUp task has no identifier.");
        var sourceKey = GetString(task, "custom_id") ?? sourceId;
        var title = GetString(task, "name") ?? $"ClickUp task {sourceKey}";
        var description = GetString(task, "text_content") ?? GetString(task, "description") ?? string.Empty;
        var url = SafeHttpsUrl(GetString(task, "url"));
        var statusObject = GetObject(task, "status");
        var status = statusObject is JsonElement s ? GetString(s, "status") ?? "To do" : "To do";
        var statusColor = NormalizeColor(statusObject is JsonElement sc ? GetString(sc, "color") : null, "#7C8B9A");
        var priorityObject = GetObject(task, "priority");
        var priority = NormalizePriority(priorityObject is JsonElement p
            ? GetString(p, "priority") ?? GetString(p, "id")
            : null);
        var dueAt = ParseUnixMilliseconds(GetString(task, "due_date"));
        var sourceCreatedAt = ParseUnixMilliseconds(GetString(task, "date_created"));
        var sourceUpdatedAt = ParseUnixMilliseconds(GetString(task, "date_updated"));
        var parent = GetString(task, "parent");

        var assignees = new List<NormalizedMigrationPerson>();
        if (TryGetArray(task, "assignees", out var assigneeArray))
        {
            foreach (var assignee in assigneeArray.EnumerateArray())
            {
                var providerId = GetString(assignee, "id") ?? string.Empty;
                var email = GetString(assignee, "email");
                var name = GetString(assignee, "username") ?? GetString(assignee, "initials") ?? email ?? providerId;
                var identity = !string.IsNullOrWhiteSpace(email) ? email.ToLowerInvariant() : $"clickup:{providerId}";
                if (!string.IsNullOrWhiteSpace(identity))
                {
                    assignees.Add(new(identity, Truncate(name, 120), email));
                }
            }
        }

        var labels = new List<NormalizedMigrationLabel>();
        if (TryGetArray(task, "tags", out var tags))
        {
            foreach (var tag in tags.EnumerateArray())
            {
                var name = GetString(tag, "name");
                if (!string.IsNullOrWhiteSpace(name))
                {
                    labels.Add(new(Truncate(name, 80), NormalizeColor(GetString(tag, "tag_bg"), "#4C9AFF")));
                }
            }
        }

        var checklist = new List<NormalizedMigrationChecklistItem>();
        if (TryGetArray(task, "checklists", out var checklists))
        {
            foreach (var group in checklists.EnumerateArray())
            {
                var groupName = GetString(group, "name");
                if (!TryGetArray(group, "items", out var checklistItems))
                {
                    continue;
                }

                foreach (var checklistItem in checklistItems.EnumerateArray())
                {
                    var itemName = GetString(checklistItem, "name");
                    if (!string.IsNullOrWhiteSpace(itemName))
                    {
                        var prefix = string.IsNullOrWhiteSpace(groupName) ? string.Empty : $"{groupName} · ";
                        checklist.Add(new(
                            Truncate(prefix + itemName, 500),
                            GetBoolean(checklistItem, "resolved") ?? false));
                    }
                }
            }
        }

        var attachments = ParseAttachments(task, "attachments");
        var dependencies = new List<string>();
        if (TryGetArray(task, "dependencies", out var dependencyArray))
        {
            foreach (var dependency in dependencyArray.EnumerateArray())
            {
                var dependsOn = GetString(dependency, "depends_on");
                if (!string.IsNullOrWhiteSpace(dependsOn))
                {
                    dependencies.Add(dependsOn);
                }
            }
        }

        return new(
            sourceId,
            Truncate(sourceKey, 80),
            url,
            Truncate(title, 240),
            description,
            Truncate(status, 80),
            statusColor,
            priority,
            sourceCreatedAt,
            sourceUpdatedAt,
            dueAt,
            assignees,
            parent,
            labels,
            checklist,
            [],
            attachments,
            dependencies);
    }

    private static List<NormalizedMigrationComment> ParseClickUpComments(JsonElement root)
    {
        var result = new List<NormalizedMigrationComment>();
        if (!TryGetArray(root, "comments", out var comments))
        {
            return result;
        }

        foreach (var comment in comments.EnumerateArray())
        {
            var body = GetString(comment, "comment_text");
            if (string.IsNullOrWhiteSpace(body) && TryGetArray(comment, "comment", out var segments))
            {
                body = string.Concat(segments.EnumerateArray().Select(segment => GetString(segment, "text") ?? string.Empty));
            }

            if (string.IsNullOrWhiteSpace(body))
            {
                continue;
            }

            var user = GetObject(comment, "user");
            var author = user is JsonElement value
                ? GetString(value, "username") ?? GetString(value, "email") ?? "ClickUp user"
                : "ClickUp user";
            result.Add(new(
                Truncate(author, 120),
                ParseUnixMilliseconds(GetString(comment, "date")),
                Truncate(body, 20_000)));
        }

        return result;
    }

    private static NormalizedMigrationItem ParseJiraIssue(
        Uri site,
        JsonElement issue,
        List<string> warnings)
    {
        var sourceId = GetString(issue, "id") ?? throw new MigrationSourceException("A Jira issue has no identifier.");
        var sourceKey = GetString(issue, "key") ?? sourceId;
        var fields = GetObject(issue, "fields") ?? throw new MigrationSourceException($"Jira issue {sourceKey} has no fields.");
        var title = GetString(fields, "summary") ?? $"Jira issue {sourceKey}";
        var description = fields.TryGetProperty("description", out var descriptionElement)
            ? ExtractAdfText(descriptionElement)
            : string.Empty;
        var statusObject = GetObject(fields, "status");
        var status = statusObject is JsonElement s ? GetString(s, "name") ?? "To do" : "To do";
        var category = statusObject is JsonElement statusValue ? GetObject(statusValue, "statusCategory") : null;
        var statusColor = JiraStatusColor(category is JsonElement c ? GetString(c, "colorName") : null);
        var priorityObject = GetObject(fields, "priority");
        var priority = NormalizePriority(priorityObject is JsonElement p ? GetString(p, "name") : null);
        var dueAt = ParseDate(GetString(fields, "duedate"));
        var sourceCreatedAt = ParseDateTime(GetString(fields, "created"));
        var sourceUpdatedAt = ParseDateTime(GetString(fields, "updated"));
        var parentObject = GetObject(fields, "parent");
        var parentId = parentObject is JsonElement parent ? GetString(parent, "id") : null;

        var assignees = new List<NormalizedMigrationPerson>();
        var assigneeObject = GetObject(fields, "assignee");
        if (assigneeObject is JsonElement assignee)
        {
            var providerId = GetString(assignee, "accountId") ?? string.Empty;
            var email = GetString(assignee, "emailAddress");
            var name = GetString(assignee, "displayName") ?? email ?? providerId;
            var identity = !string.IsNullOrWhiteSpace(email) ? email.ToLowerInvariant() : $"jira:{providerId}";
            if (!string.IsNullOrWhiteSpace(identity))
            {
                assignees.Add(new(identity, Truncate(name, 120), email));
            }
        }

        var labels = new List<NormalizedMigrationLabel>();
        if (TryGetArray(fields, "labels", out var labelArray))
        {
            foreach (var label in labelArray.EnumerateArray())
            {
                if (label.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(label.GetString()))
                {
                    labels.Add(new(Truncate(label.GetString()!, 80), "#4C9AFF"));
                }
            }
        }

        var comments = new List<NormalizedMigrationComment>();
        var commentPage = GetObject(fields, "comment");
        if (commentPage is JsonElement commentValue && TryGetArray(commentValue, "comments", out var commentArray))
        {
            foreach (var comment in commentArray.EnumerateArray())
            {
                var body = comment.TryGetProperty("body", out var bodyValue) ? ExtractAdfText(bodyValue) : string.Empty;
                if (string.IsNullOrWhiteSpace(body))
                {
                    continue;
                }

                var authorObject = GetObject(comment, "author");
                var author = authorObject is JsonElement a
                    ? GetString(a, "displayName") ?? GetString(a, "emailAddress") ?? "Jira user"
                    : "Jira user";
                comments.Add(new(
                    Truncate(author, 120),
                    ParseDateTime(GetString(comment, "created")),
                    Truncate(body, 20_000)));
            }

            var total = GetInt32(commentValue, "total");
            if (total is int totalCount && totalCount > comments.Count)
            {
                warnings.Add($"Jira returned only {comments.Count} of {totalCount} comments for {sourceKey}.");
            }
        }

        var attachments = ParseAttachments(fields, "attachment");
        var dependencies = new List<string>();
        if (TryGetArray(fields, "issuelinks", out var links))
        {
            foreach (var link in links.EnumerateArray())
            {
                var inward = GetObject(link, "inwardIssue");
                var type = GetObject(link, "type");
                var inwardLabel = type is JsonElement typeValue ? GetString(typeValue, "inward") ?? string.Empty : string.Empty;
                if (inward is JsonElement inwardIssue
                    && (inwardLabel.Contains("blocked by", StringComparison.OrdinalIgnoreCase)
                        || inwardLabel.Contains("depends on", StringComparison.OrdinalIgnoreCase)))
                {
                    var dependencyId = GetString(inwardIssue, "id");
                    if (!string.IsNullOrWhiteSpace(dependencyId))
                    {
                        dependencies.Add(dependencyId);
                    }
                }
            }
        }

        return new(
            sourceId,
            Truncate(sourceKey, 80),
            new Uri(site, $"/browse/{Uri.EscapeDataString(sourceKey)}").ToString(),
            Truncate(title, 240),
            description,
            Truncate(status, 80),
            statusColor,
            priority,
            sourceCreatedAt,
            sourceUpdatedAt,
            dueAt,
            assignees,
            parentId,
            labels,
            [],
            comments,
            attachments,
            dependencies);
    }

    private static List<NormalizedMigrationAttachment> ParseAttachments(JsonElement parent, string propertyName)
    {
        var attachments = new List<NormalizedMigrationAttachment>();
        if (!TryGetArray(parent, propertyName, out var values))
        {
            return attachments;
        }

        foreach (var attachment in values.EnumerateArray())
        {
            var url = SafeHttpsUrl(GetString(attachment, "url") ?? GetString(attachment, "content"));
            if (url is null)
            {
                continue;
            }

            var name = GetString(attachment, "title") ?? GetString(attachment, "filename") ?? "Attachment";
            attachments.Add(new(
                Truncate(name, 240),
                GetString(attachment, "type") ?? GetString(attachment, "mimeType"),
                url));
        }

        return attachments;
    }

    internal static string ExtractAdfText(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.String)
        {
            return value.GetString()?.Trim() ?? string.Empty;
        }

        if (value.ValueKind is not (JsonValueKind.Object or JsonValueKind.Array))
        {
            return string.Empty;
        }

        var builder = new StringBuilder();
        AppendAdf(value, builder);
        return Regex.Replace(builder.ToString(), @"[ \t]+\n", "\n").Trim();
    }

    private static void AppendAdf(JsonElement value, StringBuilder builder)
    {
        if (value.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in value.EnumerateArray())
            {
                AppendAdf(item, builder);
            }
            return;
        }

        if (value.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        var type = GetString(value, "type");
        if (type == "text")
        {
            builder.Append(GetString(value, "text"));
        }
        else if (type == "hardBreak")
        {
            builder.AppendLine();
        }

        if (TryGetArray(value, "content", out var content))
        {
            foreach (var child in content.EnumerateArray())
            {
                AppendAdf(child, builder);
            }
        }

        if (type is "paragraph" or "heading" or "listItem" or "blockquote" or "codeBlock")
        {
            builder.AppendLine();
        }
    }

    private static HttpRequestMessage CreateClickUpRequest(HttpMethod method, string url, string token)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.TryAddWithoutValidation("Authorization", token);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return request;
    }

    private static HttpRequestMessage CreateJiraRequest(
        HttpMethod method,
        Uri url,
        string authorization,
        string? json = null)
    {
        var request = new HttpRequestMessage(method, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", authorization);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, "application/json");
        }
        return request;
    }

    private static async Task<JsonDocument> SendJsonAsync(
        HttpClient client,
        HttpRequestMessage request,
        string operation,
        CancellationToken cancellationToken)
    {
        using var response = await client.SendAsync(
            request,
            HttpCompletionOption.ResponseContentRead,
            cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new MigrationSourceException(
                $"{operation} failed with HTTP {(int)response.StatusCode}. Check the source identifier and credentials.");
        }

        var length = response.Content.Headers.ContentLength;
        if (length is > 25_000_000)
        {
            throw new MigrationSourceException($"{operation} returned too much data.");
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        try
        {
            return await JsonDocument.ParseAsync(
                stream,
                new JsonDocumentOptions { MaxDepth = 96 },
                cancellationToken);
        }
        catch (JsonException)
        {
            throw new MigrationSourceException($"{operation} returned invalid JSON.");
        }
    }

    private static Uri ValidateJiraSite(string? value)
    {
        if (!Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.Host.EndsWith(".atlassian.net", StringComparison.OrdinalIgnoreCase)
            || (uri.Port != -1 && uri.Port != 443))
        {
            throw new MigrationSourceException("Jira site must be an HTTPS *.atlassian.net address.");
        }

        return new UriBuilder(Uri.UriSchemeHttps, uri.Host).Uri;
    }

    private static string ValidateIdentifier(string? value, string label)
    {
        var identifier = Required(value, $"{label} is required.", 80);
        if (!IdentifierRegex().IsMatch(identifier))
        {
            throw new MigrationSourceException($"{label} contains unsupported characters.");
        }
        return identifier;
    }

    private static string Required(string? value, string message, int maximumLength)
    {
        var normalized = value?.Trim() ?? string.Empty;
        if (normalized.Length is < 1 || normalized.Length > maximumLength || normalized.Any(char.IsControl))
        {
            throw new MigrationSourceException(message);
        }
        return normalized;
    }

    private static string NormalizePriority(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? string.Empty;
        if (normalized.Contains("urgent") || normalized == "1" || normalized.Contains("highest"))
        {
            return "urgent";
        }
        if (normalized.Contains("high") || normalized == "2")
        {
            return "high";
        }
        if (normalized.Contains("low") || normalized is "4" or "lowest")
        {
            return "low";
        }
        return "normal";
    }

    private static string JiraStatusColor(string? value) => value?.ToLowerInvariant() switch
    {
        "green" => "#32A86B",
        "yellow" => "#F2A93B",
        "blue-gray" => "#4C9AFF",
        "brown" => "#B46F3C",
        _ => "#7C8B9A"
    };

    private static string NormalizeColor(string? value, string fallback)
    {
        var color = value?.Trim().ToUpperInvariant();
        if (color is not null && !color.StartsWith('#'))
        {
            color = "#" + color;
        }
        return color is { Length: 7 } && color[1..].All(Uri.IsHexDigit) ? color : fallback;
    }

    private static DateTimeOffset? ParseUnixMilliseconds(string? value) =>
        long.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var milliseconds)
            ? DateTimeOffset.FromUnixTimeMilliseconds(milliseconds)
            : null;

    private static DateTimeOffset? ParseDate(string? value) =>
        DateTimeOffset.TryParseExact(
            value,
            "yyyy-MM-dd",
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal,
            out var date)
            ? date
            : null;

    private static DateTimeOffset? ParseDateTime(string? value) =>
        DateTimeOffset.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var date)
            ? date
            : null;

    private static string? SafeHttpsUrl(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttps
        && string.IsNullOrEmpty(uri.UserInfo)
            ? uri.ToString()
            : null;

    private static string Truncate(string value, int maximum) =>
        value.Length <= maximum ? value : value[..maximum];

    private static string? GetString(JsonElement parent, string propertyName)
    {
        if (!parent.TryGetProperty(propertyName, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            _ => null
        };
    }

    private static bool? GetBoolean(JsonElement parent, string propertyName) =>
        parent.TryGetProperty(propertyName, out var value)
            && value.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? value.GetBoolean()
                : null;

    private static int? GetInt32(JsonElement parent, string propertyName) =>
        parent.TryGetProperty(propertyName, out var value) && value.TryGetInt32(out var result)
            ? result
            : null;

    private static JsonElement? GetObject(JsonElement parent, string propertyName) =>
        parent.TryGetProperty(propertyName, out var value) && value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool TryGetArray(JsonElement parent, string propertyName, out JsonElement value)
    {
        if (parent.TryGetProperty(propertyName, out value) && value.ValueKind == JsonValueKind.Array)
        {
            return true;
        }

        value = default;
        return false;
    }

    [GeneratedRegex("^[A-Za-z0-9_-]{1,80}$", RegexOptions.CultureInvariant)]
    private static partial Regex IdentifierRegex();
}

public sealed class MigrationSourceException(string message) : Exception(message);
