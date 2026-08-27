using System.Diagnostics;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Plugins;

public sealed class AiAssistantExecutor(
    IHttpClientFactory httpClientFactory,
    AiSecretProtector secretProtector,
    IOptions<CyTaskOptions> options,
    ILogger<AiAssistantExecutor> logger)
{
    private const int MaximumProviderResponseBytes = 2_097_152;
    private readonly CyTaskOptions _options = options.Value;
    private static readonly Action<ILogger, string, Exception?> LogLocalStartFailure =
        LoggerMessage.Define<string>(LogLevel.Warning,
            new EventId(2402, nameof(LogLocalStartFailure)),
            "Failed to start local AI provider {Provider}");
    private static readonly Action<ILogger, string, int, string, Exception?> LogLocalExitFailure =
        LoggerMessage.Define<string, int, string>(LogLevel.Warning,
            new EventId(2403, nameof(LogLocalExitFailure)),
            "Local AI provider {Provider} exited with {ExitCode}: {Error}");

    public async Task<AiAssistantRunResult> RunAsync(
        AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        var started = Stopwatch.StartNew();
        var text = AiProviderIds.IsLocalAgent(connection.Provider)
            ? await RunLocalAgentAsync(connection, prompt, cancellationToken)
            : await RunHttpProviderAsync(connection, prompt, cancellationToken);
        started.Stop();

        text = text.Trim();
        if (text.Length == 0) throw new InvalidOperationException("Le fournisseur IA a renvoyé une réponse vide.");
        if (text.Length > _options.AiMaxOutputCharacters)
            text = text[.._options.AiMaxOutputCharacters] + "\n\n[Réponse tronquée par CyTask]";

        return new(text, connection.Provider, connection.Model, started.ElapsedMilliseconds);
    }

    private async Task<string> RunHttpProviderAsync(
        AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        var client = httpClientFactory.CreateClient("ai-assistant");
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.AiRequestTimeoutSeconds));

        return connection.Provider switch
        {
            AiProviderIds.OpenAi => await RunOpenAiAsync(client, connection, prompt, timeout.Token),
            AiProviderIds.Anthropic => await RunAnthropicAsync(client, connection, prompt, timeout.Token),
            AiProviderIds.OpenAiCompatible or AiProviderIds.LmStudio =>
                await RunOpenAiCompatibleAsync(client, connection, prompt, timeout.Token),
            AiProviderIds.Ollama => await RunOllamaAsync(client, connection, prompt, timeout.Token),
            _ => throw new InvalidOperationException("Fournisseur IA non pris en charge.")
        };
    }

    private async Task<string> RunOpenAiAsync(
        HttpClient client, AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.openai.com/v1/responses");
        request.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer", RequiredSecret(connection));
        request.Content = JsonContent.Create(new
        {
            model = connection.Model,
            input = prompt,
            max_output_tokens = 2400,
            store = false
        });
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        using var document = await ReadResponseAsync(response, cancellationToken);
        if (!document.RootElement.TryGetProperty("output", out var output)) return string.Empty;

        var parts = new List<string>();
        foreach (var item in output.EnumerateArray())
        {
            if (!item.TryGetProperty("content", out var content)) continue;
            foreach (var part in content.EnumerateArray())
            {
                if (part.TryGetProperty("type", out var type)
                    && type.GetString() == "output_text"
                    && part.TryGetProperty("text", out var text))
                    parts.Add(text.GetString() ?? string.Empty);
            }
        }
        return string.Join("\n", parts);
    }

    private async Task<string> RunAnthropicAsync(
        HttpClient client, AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "https://api.anthropic.com/v1/messages");
        request.Headers.Add("x-api-key", RequiredSecret(connection));
        request.Headers.Add("anthropic-version", "2023-06-01");
        request.Content = JsonContent.Create(new
        {
            model = connection.Model,
            max_tokens = 2400,
            messages = new[] { new { role = "user", content = prompt } }
        });
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        using var document = await ReadResponseAsync(response, cancellationToken);
        if (!document.RootElement.TryGetProperty("content", out var content)) return string.Empty;

        return string.Join("\n", content.EnumerateArray()
            .Where(part => part.TryGetProperty("type", out var type) && type.GetString() == "text")
            .Select(part => part.TryGetProperty("text", out var text) ? text.GetString() : null)
            .Where(text => !string.IsNullOrWhiteSpace(text)));
    }

    private async Task<string> RunOpenAiCompatibleAsync(
        HttpClient client, AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        var endpoint = await ResolveCustomEndpointAsync(
            connection.BaseUrl, "/chat/completions", cancellationToken);
        using var request = new HttpRequestMessage(HttpMethod.Post, endpoint);
        if (!string.IsNullOrWhiteSpace(connection.ProtectedSecret))
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", RequiredSecret(connection));
        request.Content = JsonContent.Create(new
        {
            model = connection.Model,
            messages = new[] { new { role = "user", content = prompt } },
            stream = false
        });
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        using var document = await ReadResponseAsync(response, cancellationToken);
        return document.RootElement.GetProperty("choices")[0]
            .GetProperty("message").GetProperty("content").GetString() ?? string.Empty;
    }

    private async Task<string> RunOllamaAsync(
        HttpClient client, AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        var endpoint = await ResolveCustomEndpointAsync(connection.BaseUrl, "/api/generate", cancellationToken);
        using var response = await client.PostAsJsonAsync(endpoint, new
        {
            model = connection.Model,
            prompt,
            stream = false
        }, cancellationToken);
        using var document = await ReadResponseAsync(response, cancellationToken);
        return document.RootElement.TryGetProperty("response", out var text)
            ? text.GetString() ?? string.Empty : string.Empty;
    }

    private async Task<string> RunLocalAgentAsync(
        AiProviderConnection connection, string prompt, CancellationToken cancellationToken)
    {
        if (!_options.AiLocalAgentsEnabled)
            throw new InvalidOperationException("Les agents locaux sont désactivés sur ce serveur.");
        if (string.IsNullOrWhiteSpace(_options.AiLocalWorkspacePath)
            || !Directory.Exists(_options.AiLocalWorkspacePath))
            throw new InvalidOperationException("Le dossier de travail des agents locaux n’est pas configuré.");

        var start = new ProcessStartInfo
        {
            FileName = connection.Provider switch
            {
                AiProviderIds.Codex => _options.CodexExecutable,
                AiProviderIds.ClaudeCode => _options.ClaudeExecutable,
                AiProviderIds.OpenCode => _options.OpenCodeExecutable,
                _ => throw new InvalidOperationException("Agent local inconnu.")
            },
            WorkingDirectory = Path.GetFullPath(_options.AiLocalWorkspacePath),
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };

        SanitizeLocalEnvironment(start);

        if (connection.Provider == AiProviderIds.Codex)
        {
            AddArguments(start, "exec", "--sandbox", "read-only", "--ask-for-approval", "never",
                "--skip-git-repo-check");
            if (connection.Model.Length > 0) AddArguments(start, "--model", connection.Model);
            start.ArgumentList.Add("-");
        }
        else if (connection.Provider == AiProviderIds.ClaudeCode)
        {
            AddArguments(start, "-p", "--permission-mode", "plan", "--max-turns", "1",
                "--output-format", "text");
            if (connection.Model.Length > 0) AddArguments(start, "--model", connection.Model);
        }
        else
        {
            AddArguments(start, "run", "--agent", "plan");
            if (connection.Model.Length > 0) AddArguments(start, "--model", connection.Model);
            start.Environment["OPENCODE_CONFIG_CONTENT"] =
                "{\"permission\":{\"*\":\"deny\"}}";
        }

        using var process = new Process { StartInfo = start };
        try
        {
            if (!process.Start()) throw new InvalidOperationException("Impossible de lancer l’agent local.");
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            LogLocalStartFailure(logger, connection.Provider, exception);
            throw new InvalidOperationException(
                "L’exécutable de l’agent local est introuvable ou ne peut pas démarrer.");
        }

        await process.StandardInput.WriteAsync(prompt.AsMemory(), cancellationToken);
        process.StandardInput.Close();
        var outputTask = process.StandardOutput.ReadToEndAsync(cancellationToken);
        var errorTask = process.StandardError.ReadToEndAsync(cancellationToken);

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.AiRequestTimeoutSeconds));
        try
        {
            await process.WaitForExitAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            try { process.Kill(true); } catch (InvalidOperationException) { }
            throw new TimeoutException("L’agent IA local a dépassé le délai autorisé.");
        }

        var output = await outputTask;
        var error = await errorTask;
        if (process.ExitCode != 0)
        {
            var safeError = error.Length > 1200 ? error[..1200] : error;
            LogLocalExitFailure(logger, connection.Provider, process.ExitCode, safeError, null);
            throw new InvalidOperationException("L’agent local a échoué. Consultez les journaux du serveur.");
        }
        return output;
    }

    private string RequiredSecret(AiProviderConnection connection)
    {
        if (string.IsNullOrWhiteSpace(connection.ProtectedSecret))
            throw new InvalidOperationException("Cette connexion ne possède pas de jeton.");
        return secretProtector.Unprotect(connection.ProtectedSecret);
    }

    private async Task<Uri> ResolveCustomEndpointAsync(
        string? baseUrl, string suffix, CancellationToken cancellationToken)
    {
        if (!Uri.TryCreate(baseUrl, UriKind.Absolute, out var uri)
            || uri.Scheme is not ("http" or "https") || !string.IsNullOrEmpty(uri.UserInfo)
            || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new InvalidOperationException("L’URL du fournisseur est invalide.");

        if (!_options.AiAllowPrivateEndpoints)
        {
            if (uri.Scheme != "https")
                throw new InvalidOperationException(
                    "Les fournisseurs distants doivent utiliser HTTPS. Activez explicitement les endpoints privés pour Ollama ou LM Studio.");
            IPAddress[] addresses;
            try { addresses = await Dns.GetHostAddressesAsync(uri.DnsSafeHost, cancellationToken); }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                throw new InvalidOperationException("Le nom d’hôte du fournisseur ne peut pas être résolu.");
            }
            if (addresses.Length == 0 || addresses.Any(IsPrivateAddress))
                throw new InvalidOperationException("Les adresses locales ou privées sont bloquées par le serveur.");
        }

        var root = baseUrl!.TrimEnd('/');
        if (root.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            return new Uri(root, UriKind.Absolute);
        if (suffix == "/chat/completions" && !root.EndsWith("/v1", StringComparison.OrdinalIgnoreCase))
            root += "/v1";
        return new Uri(root + suffix, UriKind.Absolute);
    }

    private static bool IsPrivateAddress(IPAddress address)
    {
        if (IPAddress.IsLoopback(address)) return true;
        if (address.IsIPv4MappedToIPv6) address = address.MapToIPv4();
        var bytes = address.GetAddressBytes();
        if (bytes.Length == 4)
            return bytes[0] == 10 || bytes[0] == 127
                || (bytes[0] == 169 && bytes[1] == 254)
                || (bytes[0] == 172 && bytes[1] is >= 16 and <= 31)
                || (bytes[0] == 192 && bytes[1] == 168)
                || bytes[0] == 0;
        return address.IsIPv6LinkLocal || address.IsIPv6SiteLocal
            || address.Equals(IPAddress.IPv6Any) || address.Equals(IPAddress.IPv6Loopback)
            || (bytes[0] & 0xfe) == 0xfc;
    }

    private static async Task<JsonDocument> ReadResponseAsync(
        HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.Content.Headers.ContentLength > MaximumProviderResponseBytes)
            throw new InvalidOperationException("La réponse du fournisseur dépasse la limite autorisée.");

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffer = new MemoryStream();
        var chunk = new byte[16_384];
        while (true)
        {
            var read = await stream.ReadAsync(chunk.AsMemory(), cancellationToken);
            if (read == 0) break;
            if (buffer.Length + read > MaximumProviderResponseBytes)
                throw new InvalidOperationException("La réponse du fournisseur dépasse la limite autorisée.");
            await buffer.WriteAsync(chunk.AsMemory(0, read), cancellationToken);
        }

        var payload = buffer.ToArray();
        if (!response.IsSuccessStatusCode)
        {
            string? message = null;
            try
            {
                using var error = JsonDocument.Parse(payload);
                message = error.RootElement.TryGetProperty("error", out var value)
                    ? value.ValueKind == JsonValueKind.String ? value.GetString()
                        : value.TryGetProperty("message", out var nested) ? nested.GetString() : null
                    : null;
            }
            catch (JsonException)
            {
                // Les pages d’erreur HTML ne sont jamais reflétées dans la réponse CyTask.
            }
            throw new InvalidOperationException(
                $"Le fournisseur IA a refusé la requête ({(int)response.StatusCode})"
                + (string.IsNullOrWhiteSpace(message) ? "." : $" : {message}"));
        }

        try { return JsonDocument.Parse(payload); }
        catch (JsonException)
        {
            throw new InvalidOperationException("Le fournisseur IA a renvoyé un format JSON invalide.");
        }
    }

    private static void SanitizeLocalEnvironment(ProcessStartInfo start)
    {
        var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "PATH", "PATHEXT", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
            "TEMP", "TMP", "SYSTEMROOT", "WINDIR", "COMSPEC", "LANG", "LC_ALL",
            "SSL_CERT_FILE", "SSL_CERT_DIR", "CODEX_HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME"
        };
        foreach (var key in start.Environment.Keys.ToArray())
        {
            if (!allowed.Contains(key)) start.Environment.Remove(key);
        }
    }

    private static void AddArguments(ProcessStartInfo start, params string[] arguments)
    {
        foreach (var argument in arguments) start.ArgumentList.Add(argument);
    }
}