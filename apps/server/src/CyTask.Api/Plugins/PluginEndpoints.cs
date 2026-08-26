using System.Text.Json;
using CyTask.Api.Infrastructure;
using CyTask.Api.Realtime;
using CyTask.Api.Security;

namespace CyTask.Api.Plugins;

public static class PluginEndpoints
{
    private const int MaximumDataBytes = 65_536;

    public static RouteGroupBuilder MapPluginEndpoints(this RouteGroupBuilder authenticated)
    {
        authenticated.MapGet("/plugins/catalog", ListCatalog);
        authenticated.MapGet("/projects/{projectId:guid}/plugins", ListProjectPluginsAsync);
        authenticated.MapPut("/projects/{projectId:guid}/plugins/{pluginId}", EnableProjectPluginAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapDelete("/projects/{projectId:guid}/plugins/{pluginId}", DisableProjectPluginAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin"));
        authenticated.MapGet("/tasks/{taskId:guid}/plugins", ListTaskPluginsAsync);
        authenticated.MapGet("/tasks/{taskId:guid}/plugins/{pluginId}/data", GetTaskPluginDataAsync);
        authenticated.MapGet("/tasks/{taskId:guid}/plugins/{pluginId}/history", ListTaskPluginDataHistoryAsync);
        authenticated.MapPut("/tasks/{taskId:guid}/plugins/{pluginId}/data", UpdateTaskPluginDataAsync)
            .AddEndpointFilter<CsrfFilter>()
            .AddEndpointFilter(new RequireRoleFilter("owner", "admin", "member"));
        return authenticated;
    }

    private static IResult ListCatalog(PluginCatalog catalog) => Results.Ok(catalog.List());

    private static async Task<IResult> ListProjectPluginsAsync(
        Guid projectId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        if (!await ProjectExistsAsync(workspace, user.OrganizationId, projectId, cancellationToken))
        {
            return Results.NotFound();
        }

        var enabled = await plugins.ListProjectPluginsAsync(
            user.OrganizationId, projectId, cancellationToken);
        var enabledById = enabled.ToDictionary(item => item.PluginId, StringComparer.Ordinal);
        return Results.Ok(catalog.List().Select(manifest =>
        {
            var state = enabledById.GetValueOrDefault(manifest.Id);
            return new ProjectPluginView(manifest, state is not null, state?.EnabledAt);
        }));
    }

    private static async Task<IResult> EnableProjectPluginAsync(
        Guid projectId,
        string pluginId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var manifest = catalog.Find(pluginId);
        if (manifest is null) return Results.NotFound();

        var user = context.GetUser()!;
        if (!await ProjectExistsAsync(workspace, user.OrganizationId, projectId, cancellationToken))
        {
            return Results.NotFound();
        }

        var state = await plugins.EnableProjectPluginAsync(
            user.OrganizationId, projectId, pluginId, user.UserId, cancellationToken);
        events.Publish(user.OrganizationId, "project.plugin_enabled", projectId);
        return Results.Ok(new ProjectPluginView(manifest, true, state.EnabledAt));
    }

    private static async Task<IResult> DisableProjectPluginAsync(
        Guid projectId,
        string pluginId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        if (catalog.Find(pluginId) is null) return Results.NotFound();

        var user = context.GetUser()!;
        if (!await ProjectExistsAsync(workspace, user.OrganizationId, projectId, cancellationToken))
        {
            return Results.NotFound();
        }

        await plugins.DisableProjectPluginAsync(
            user.OrganizationId, projectId, pluginId, cancellationToken);
        events.Publish(user.OrganizationId, "project.plugin_disabled", projectId);
        return Results.NoContent();
    }

    private static async Task<IResult> ListTaskPluginsAsync(
        Guid taskId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var user = context.GetUser()!;
        var task = await workspace.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (task is null) return Results.NotFound();

        var states = await plugins.ListProjectPluginsAsync(
            user.OrganizationId, task.Task.ProjectId, cancellationToken);
        var views = new List<TaskPluginView>();
        foreach (var state in states.Where(item => item.Enabled))
        {
            var manifest = catalog.Find(state.PluginId);
            if (manifest is null) continue;
            var data = await plugins.GetTaskPluginDataAsync(
                user.OrganizationId, taskId, state.PluginId, cancellationToken);
            views.Add(new(
                manifest,
                data?.Data ?? EmptyObject(),
                data?.Revision ?? 0,
                data?.UpdatedAt));
        }

        return Results.Ok(views);
    }

    private static async Task<IResult> GetTaskPluginDataAsync(
        Guid taskId,
        string pluginId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        var manifest = catalog.Find(pluginId);
        if (manifest is null) return Results.NotFound();

        var user = context.GetUser()!;
        var task = await workspace.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (task is null) return Results.NotFound();
        if (!await IsEnabledAsync(
            plugins, user.OrganizationId, task.Task.ProjectId, pluginId, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Le plugin n’est pas activé pour ce projet.");
        }

        var data = await plugins.GetTaskPluginDataAsync(
            user.OrganizationId, taskId, pluginId, cancellationToken);
        return Results.Ok(new TaskPluginView(
            manifest, data?.Data ?? EmptyObject(), data?.Revision ?? 0, data?.UpdatedAt));
    }

    private static async Task<IResult> ListTaskPluginDataHistoryAsync(
        Guid taskId,
        string pluginId,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        CancellationToken cancellationToken)
    {
        if (catalog.Find(pluginId) is null) return Results.NotFound();

        var user = context.GetUser()!;
        var task = await workspace.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (task is null) return Results.NotFound();
        if (!await IsEnabledAsync(
            plugins, user.OrganizationId, task.Task.ProjectId, pluginId, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Le plugin n’est pas activé pour ce projet.");
        }

        var history = await plugins.ListTaskPluginDataHistoryAsync(
            user.OrganizationId, taskId, pluginId, 100, cancellationToken);
        return Results.Ok(history.Select(item => new TaskPluginHistoryView(
            item.Data, item.Revision, item.UpdatedBy, item.UpdatedAt)));
    }

    private static async Task<IResult> UpdateTaskPluginDataAsync(
        Guid taskId,
        string pluginId,
        UpdateTaskPluginDataRequest request,
        HttpContext context,
        PluginCatalog catalog,
        IPluginStore plugins,
        IWorkspaceStore workspace,
        WorkspaceEventHub events,
        CancellationToken cancellationToken)
    {
        var manifest = catalog.Find(pluginId);
        if (manifest is null) return Results.NotFound();
        if (request.ExpectedRevision < 0)
        {
            return Validation("expectedRevision", "La révision attendue ne peut pas être négative.");
        }

        var validation = ValidateData(manifest, request.Data);
        if (validation.Count > 0) return Results.ValidationProblem(validation);

        var user = context.GetUser()!;
        var task = await workspace.GetTaskAsync(user.OrganizationId, taskId, cancellationToken);
        if (task is null) return Results.NotFound();
        if (!await IsEnabledAsync(
            plugins, user.OrganizationId, task.Task.ProjectId, pluginId, cancellationToken))
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Le plugin n’est pas activé pour ce projet.");
        }

        var updated = await plugins.UpsertTaskPluginDataAsync(
            user.OrganizationId,
            task.Task.ProjectId,
            taskId,
            pluginId,
            request.Data,
            request.ExpectedRevision,
            user.UserId,
            cancellationToken);
        if (updated is null)
        {
            return Results.Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Les données du plugin ont été modifiées. Rechargez le ticket.");
        }

        events.Publish(user.OrganizationId, "task.plugin_data_updated", taskId);
        return Results.Ok(new TaskPluginView(
            manifest, updated.Data, updated.Revision, updated.UpdatedAt));
    }

    private static Dictionary<string, string[]> ValidateData(
        PluginManifest manifest, JsonElement data)
    {
        var errors = new Dictionary<string, string[]>(StringComparer.Ordinal);
        if (data.ValueKind != JsonValueKind.Object)
        {
            errors["data"] = ["Les données du plugin doivent être un objet JSON."];
            return errors;
        }

        if (JsonSerializer.SerializeToUtf8Bytes(data).Length > MaximumDataBytes)
        {
            errors["data"] = ["Les données du plugin dépassent 64 Kio."];
            return errors;
        }

        var fields = manifest.Contributes.TaskTabs
            .SelectMany(tab => tab.Fields)
            .ToDictionary(field => field.Key, StringComparer.Ordinal);
        foreach (var property in data.EnumerateObject())
        {
            if (!fields.ContainsKey(property.Name))
            {
                errors[$"data.{property.Name}"] = ["Ce champ n’est pas déclaré par le plugin."];
            }
        }

        foreach (var field in fields.Values)
        {
            if (!data.TryGetProperty(field.Key, out var value)
                || value.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
            {
                if (field.Required) errors[$"data.{field.Key}"] = ["Ce champ est obligatoire."];
                continue;
            }

            var error = ValidateField(field, value);
            if (error is not null) errors[$"data.{field.Key}"] = [error];
        }

        return errors;
    }

    private static string? ValidateField(PluginFieldDefinition field, JsonElement value)
    {
        if (field.Type == "boolean")
        {
            return value.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? null : "Une valeur booléenne est attendue.";
        }
        if (field.Type == "number")
        {
            return value.ValueKind == JsonValueKind.Number ? null : "Un nombre est attendu.";
        }
        if (field.Type == "string-list")
        {
            if (value.ValueKind != JsonValueKind.Array) return "Une liste de textes est attendue.";
            var values = value.EnumerateArray().ToArray();
            if (values.Length > 100) return "La liste ne peut pas dépasser 100 éléments.";
            foreach (var item in values)
            {
                if (item.ValueKind != JsonValueKind.String) return "Chaque élément doit être un texte.";
                var text = item.GetString() ?? string.Empty;
                if (text.Length > (field.MaxLength ?? 1024)) return "Un élément de la liste est trop long.";
                if (field.Key == "assetPaths" && !IsUnrealPath(text)) return "Chaque asset doit utiliser /Game ou /Plugins.";
                if (field.Key == "filePaths" && !IsProjectRelativePath(text))
                {
                    return "Chaque fichier doit utiliser un chemin relatif au projet, sans traversée.";
                }
            }
            return null;
        }

        if (value.ValueKind != JsonValueKind.String) return "Un texte est attendu.";
        var candidate = value.GetString() ?? string.Empty;
        if (candidate.Length > (field.MaxLength ?? 2000)) return "La valeur est trop longue.";
        if (field.Type is "asset-path" or "map-path" && !IsUnrealPath(candidate))
        {
            return "Le chemin doit utiliser /Game ou /Plugins.";
        }
        if (field.Type == "select" && field.Options is { Count: > 0 }
            && candidate.Length > 0 && !field.Options.Contains(candidate, StringComparer.Ordinal))
        {
            return "La valeur ne fait pas partie des options autorisées.";
        }
        return null;
    }

    private static bool IsProjectRelativePath(string value)
    {
        if (value.Length == 0) return true;
        if (value.StartsWith('/') || value.StartsWith('\\')
            || value.Contains('\\') || value.Contains(':') || value.Contains("//", StringComparison.Ordinal)
            || value.Any(character => char.IsControl(character)))
        {
            return false;
        }

        var segments = value.Split('/', StringSplitOptions.None);
        return segments.Length > 0
            && segments.All(segment => segment.Length > 0 && segment is not "." and not "..");
    }

    private static bool IsUnrealPath(string value) =>
        value.Length == 0
        || value.StartsWith("/Game/", StringComparison.Ordinal)
        || value.StartsWith("/Plugins/", StringComparison.Ordinal);

    private static async Task<bool> ProjectExistsAsync(
        IWorkspaceStore workspace, Guid organizationId, Guid projectId,
        CancellationToken cancellationToken) =>
        (await workspace.ListProjectsAsync(organizationId, cancellationToken))
            .Any(project => project.Id == projectId);

    private static async Task<bool> IsEnabledAsync(
        IPluginStore plugins, Guid organizationId, Guid projectId, string pluginId,
        CancellationToken cancellationToken) =>
        (await plugins.ListProjectPluginsAsync(organizationId, projectId, cancellationToken))
            .Any(state => state.Enabled && string.Equals(state.PluginId, pluginId, StringComparison.Ordinal));

    private static JsonElement EmptyObject()
    {
        using var document = JsonDocument.Parse("{}");
        return document.RootElement.Clone();
    }

    private static IResult Validation(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });
}
