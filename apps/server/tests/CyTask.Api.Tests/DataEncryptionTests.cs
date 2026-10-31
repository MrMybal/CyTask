using System.Security.Cryptography;
using System.Text;
using CyTask.Api.Configuration;
using CyTask.Api.Security;
using Microsoft.Extensions.Options;
using Xunit;

namespace CyTask.Api.Tests;

public sealed class DataEncryptionTests
{
    private static DataEncryption Create(string? key = null, bool enabled = true) => new(Options.Create(new CyTaskOptions
        { DataEncryptionEnabled = enabled, DataEncryptionKey = key ?? Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)) }));

    [Fact]
    public void TextEnvelopesAreRandomizedAuthenticatedAndPurposeBound()
    {
        var key = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        using var encryption = Create(key); using var other = Create(); using var disabled = Create(enabled: false);
        const string value = "Private fixture content: \u00e9\u00e0\ud83d\ude80";
        var first = encryption.ProtectText(value, "fixture"); var second = encryption.ProtectText(value, "fixture");
        Assert.NotEqual(first, second); Assert.DoesNotContain(value, first);
        Assert.Equal(value, encryption.UnprotectText(first, "fixture"));
        Assert.ThrowsAny<CryptographicException>(() => other.UnprotectText(first, "fixture"));
        Assert.ThrowsAny<CryptographicException>(() => encryption.UnprotectText(first, "other"));
        Assert.Throws<CryptographicException>(() => disabled.UnprotectText(first, "fixture"));
        var bytes = Convert.FromBase64String(first[DataEncryption.TextPrefix.Length..]); bytes[^1] ^= 1;
        Assert.ThrowsAny<CryptographicException>(() => encryption.UnprotectText(DataEncryption.TextPrefix + Convert.ToBase64String(bytes), "fixture"));
        Assert.Equal(value, disabled.ProtectText(value, "fixture"));
        Assert.Equal("cytask:enc:v1:literal fixture", disabled.Decode("cytask:enc:v1:literal fixture"));
    }

    [Theory]
    [InlineData(0)] [InlineData(1)] [InlineData(65535)] [InlineData(65536)] [InlineData(65537)] [InlineData(400000)]
    public async Task FilesSupportStreamingAndRandomAccessWithoutPlaintextOnDisk(int length)
    {
        var folder = Path.Combine(Path.GetTempPath(), "CyTask-Encryption-Fixture-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "fixture.blob");
        try
        {
            using var encryption = Create(); var value = RandomNumberGenerator.GetBytes(length);
            await using (var target = encryption.CreateFile(path, "fixture"))
                for (var offset = 0; offset < length; offset += 137)
                    await target.WriteAsync(value.AsMemory(offset, Math.Min(137, length - offset)), TestContext.Current.CancellationToken);
            Assert.True(new FileInfo(path).Length > length);
            await using var source = encryption.OpenFile(path, "fixture"); Assert.Equal(length, source.Length); Assert.True(source.CanSeek);
            using var restored = new MemoryStream(); await source.CopyToAsync(restored, TestContext.Current.CancellationToken); Assert.Equal(value, restored.ToArray());
            if (length > 2)
            {
                source.Seek(length / 2, SeekOrigin.Begin); var read = new byte[Math.Min(80000, length - length / 2)];
                await source.ReadExactlyAsync(read, TestContext.Current.CancellationToken); Assert.Equal(value.AsSpan(length / 2, read.Length).ToArray(), read);
                source.Seek(-1, SeekOrigin.End); Assert.Equal(value[^1], source.ReadByte());
            }
            using var wrong = Create(); Assert.ThrowsAny<CryptographicException>(() => wrong.OpenFile(path, "fixture"));
            Assert.ThrowsAny<CryptographicException>(() => encryption.OpenFile(path, "other"));
            using var disabled = Create(enabled: false); Assert.Throws<CryptographicException>(() => disabled.OpenFile(path, "fixture"));
        }
        finally { Directory.Delete(folder, true); }
    }

    [Theory]
    [InlineData(40)] [InlineData(64)] [InlineData(70000)]
    public async Task ModifiedFilesFailAuthentication(int offset)
    {
        var folder = Path.Combine(Path.GetTempPath(), "CyTask-Encryption-Fixture-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "fixture.blob");
        try
        {
            using var encryption = Create();
            await using (var target = encryption.CreateFile(path, "fixture")) await target.WriteAsync(new byte[80000], TestContext.Current.CancellationToken);
            var bytes = await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken); bytes[offset] ^= 1;
            await File.WriteAllBytesAsync(path, bytes, TestContext.Current.CancellationToken);
            Assert.ThrowsAny<CryptographicException>(() => { using var source = encryption.OpenFile(path, "fixture"); source.CopyTo(Stream.Null); });
        }
        finally { Directory.Delete(folder, true); }
    }

    [Fact]
    public async Task ExistingFilesRequireExplicitOfflineConversionAndOriginalKey()
    {
        var folder = Path.Combine(Path.GetTempPath(), "CyTask-Encryption-Fixture-" + Guid.NewGuid().ToString("N")); Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, "fixture.json");
        try
        {
            const string plaintext = "{\"title\":\"Private migration fixture\"}";
            await File.WriteAllTextAsync(path, plaintext, TestContext.Current.CancellationToken);
            using var encryption = Create(); var migration = new DirectoryEncryption(encryption);
            await Assert.ThrowsAsync<InvalidOperationException>(() => migration.InitializeAsync(folder, "fixture", p => p.EndsWith(".json", StringComparison.Ordinal), false, TestContext.Current.CancellationToken));
            Assert.Equal(plaintext, await File.ReadAllTextAsync(path, TestContext.Current.CancellationToken));
            Assert.False(File.Exists(Path.Combine(folder, "encryption.state")));
            await migration.InitializeAsync(folder, "fixture", p => p.EndsWith(".json", StringComparison.Ordinal), false, TestContext.Current.CancellationToken, migrateOffline: true);
            Assert.DoesNotContain("Private migration fixture", Encoding.UTF8.GetString(await File.ReadAllBytesAsync(path, TestContext.Current.CancellationToken)));
            using (var reader = new StreamReader(encryption.OpenFile(path, "fixture"))) Assert.Equal(plaintext, await reader.ReadToEndAsync(TestContext.Current.CancellationToken));
            using var other = Create();
            await Assert.ThrowsAsync<AuthenticationTagMismatchException>(() => new DirectoryEncryption(other).InitializeAsync(folder, "fixture", _ => false, false, TestContext.Current.CancellationToken));
            using var disabled = Create(enabled: false);
            await Assert.ThrowsAsync<CryptographicException>(() => new DirectoryEncryption(disabled).InitializeAsync(folder, "fixture", _ => false, false, TestContext.Current.CancellationToken));
        }
        finally { Directory.Delete(folder, true); }
    }
}
