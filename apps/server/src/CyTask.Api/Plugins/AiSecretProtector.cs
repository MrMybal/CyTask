using System.Security.Cryptography;
using CyTask.Api.Configuration;
using Microsoft.Extensions.Options;

namespace CyTask.Api.Plugins;

public sealed class AiSecretProtector
{
    private const int KeyBytes = 32;
    private const int NonceBytes = 12;
    private const int TagBytes = 16;
    private readonly byte[]? _key;
    private static readonly Action<ILogger, Exception?> LogEphemeralKey =
        LoggerMessage.Define(LogLevel.Warning, new EventId(2401, nameof(LogEphemeralKey)),
            "Using an ephemeral AI plugin secret key. Connections are intentionally unreadable after restart.");

    public AiSecretProtector(IOptions<CyTaskOptions> options, ILogger<AiSecretProtector> logger)
    {
        var configured = options.Value.PluginSecretKey;
        if (!string.IsNullOrWhiteSpace(configured))
        {
            try
            {
                var candidate = Convert.FromBase64String(configured);
                if (candidate.Length != KeyBytes) throw new FormatException();
                _key = candidate;
            }
            catch (FormatException)
            {
                throw new InvalidOperationException(
                    "CyTask:PluginSecretKey must be a base64-encoded 32-byte key.");
            }
        }
        else if (options.Value.UseInMemoryStore)
        {
            _key = RandomNumberGenerator.GetBytes(KeyBytes);
            LogEphemeralKey(logger, null);
        }
    }

    public static bool IsValidKey(string? configured)
    {
        if (string.IsNullOrWhiteSpace(configured)) return false;
        try { return Convert.FromBase64String(configured).Length == KeyBytes; }
        catch (FormatException) { return false; }
    }

    public bool IsConfigured => _key is not null;

    public string Protect(string secret)
    {
        if (_key is null)
        {
            throw new InvalidOperationException(
                "CyTask:PluginSecretKey is required before storing provider secrets.");
        }

        var plaintext = System.Text.Encoding.UTF8.GetBytes(secret);
        var nonce = RandomNumberGenerator.GetBytes(NonceBytes);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagBytes];
        using var aes = new AesGcm(_key, TagBytes);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, "cytask.ai.v1"u8);
        CryptographicOperations.ZeroMemory(plaintext);
        return string.Join('.', "v1", Convert.ToBase64String(nonce),
            Convert.ToBase64String(tag), Convert.ToBase64String(ciphertext));
    }

    public string Unprotect(string payload)
    {
        if (_key is null) throw new InvalidOperationException("AI plugin secret protection is not configured.");
        var parts = payload.Split('.', StringSplitOptions.None);
        if (parts.Length != 4 || parts[0] != "v1") throw new CryptographicException("Unsupported secret format.");
        var nonce = Convert.FromBase64String(parts[1]);
        var tag = Convert.FromBase64String(parts[2]);
        var ciphertext = Convert.FromBase64String(parts[3]);
        var plaintext = new byte[ciphertext.Length];
        using var aes = new AesGcm(_key, TagBytes);
        aes.Decrypt(nonce, ciphertext, tag, plaintext, "cytask.ai.v1"u8);
        try { return System.Text.Encoding.UTF8.GetString(plaintext); }
        finally { CryptographicOperations.ZeroMemory(plaintext); }
    }
}