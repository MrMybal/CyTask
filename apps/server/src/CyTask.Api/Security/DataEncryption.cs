using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using CyTask.Api.Configuration;

namespace CyTask.Api.Security;

/// <summary>Server-side encryption at rest. Keys never belong in a workspace or its sync transport.</summary>
public sealed class DataEncryption : IDisposable
{
    public const string TextPrefix = "cytask:enc:v1:";
    private readonly byte[]? _key;
    public bool Enabled => _key is not null;

    public DataEncryption(IOptions<CyTaskOptions> options)
    {
        if (!options.Value.DataEncryptionEnabled) return;
        if (!ValidKey(options.Value.DataEncryptionKey))
            throw new InvalidOperationException("DataEncryptionKey must be a base64-encoded 32-byte key. Back it up separately from the data.");
        _key = Convert.FromBase64String(options.Value.DataEncryptionKey!);
    }

    public static bool ValidKey(string? value)
    {
        if (value is null) return false;
        Span<byte> bytes = stackalloc byte[32];
        var valid = Convert.TryFromBase64String(value, bytes, out var count) && count == 32;
        CryptographicOperations.ZeroMemory(bytes);
        return valid;
    }

    internal byte[] DeriveKey(ReadOnlySpan<byte> salt, string purpose)
    {
        if (_key is null) throw new CryptographicException("This data is encrypted. Enable data encryption and supply its original key.");
        return HKDF.DeriveKey(HashAlgorithmName.SHA256, _key, 32, salt.ToArray(), Encoding.UTF8.GetBytes("cytask.storage.v1:" + purpose));
    }

    public string ProtectText(string value, string purpose)
    {
        if (!Enabled) return value;
        var plain = Encoding.UTF8.GetBytes(value);
        var salt = RandomNumberGenerator.GetBytes(32);
        var key = DeriveKey(salt, purpose);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var result = new byte[60 + plain.Length];
        salt.CopyTo(result, 0); nonce.CopyTo(result, 32);
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Encrypt(nonce, plain, result.AsSpan(60), result.AsSpan(44, 16), Encoding.UTF8.GetBytes(purpose));
            return TextPrefix + Convert.ToBase64String(result);
        }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plain); }
    }

    public string UnprotectText(string value, string purpose)
    {
        if (!value.StartsWith(TextPrefix, StringComparison.Ordinal)) return value;
        byte[] envelope;
        try { envelope = Convert.FromBase64String(value[TextPrefix.Length..]); }
        catch (FormatException) { throw new CryptographicException("Invalid encrypted data envelope."); }
        if (envelope.Length < 60) throw new CryptographicException("Invalid encrypted data envelope.");
        var key = DeriveKey(envelope.AsSpan(0, 32), purpose);
        var plain = new byte[envelope.Length - 60];
        try
        {
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(envelope.AsSpan(32, 12), envelope.AsSpan(60), envelope.AsSpan(44, 16), plain, Encoding.UTF8.GetBytes(purpose));
            return Encoding.UTF8.GetString(plain);
        }
        finally { CryptographicOperations.ZeroMemory(key); CryptographicOperations.ZeroMemory(plain); }
    }

    public Stream CreateFile(string path, string purpose) => Enabled
        ? EncryptedFileStream.Create(path, this, purpose)
        : new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None, 65536, FileOptions.Asynchronous);

    public Stream OpenFile(string path, string purpose)
    {
        var source = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read | FileShare.Delete, 65536, FileOptions.Asynchronous);
        try
        {
            if (EncryptedFileStream.HasHeader(source)) return EncryptedFileStream.Open(source, this, purpose);
            source.Position = 0;
            if (Enabled) throw new CryptographicException("Unencrypted stored data requires an explicit offline migration before encryption can be enabled.");
            return source;
        }
        catch { source.Dispose(); throw; }
    }

    public void Dispose() { if (_key is not null) CryptographicOperations.ZeroMemory(_key); }
}
