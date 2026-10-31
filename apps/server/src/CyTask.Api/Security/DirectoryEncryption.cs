using System.Security.Cryptography;

namespace CyTask.Api.Security;

public sealed class DirectoryEncryption(DataEncryption encryption)
{
    public async Task InitializeAsync(string root, string purpose, Func<string, bool> include,
        bool snapshotNames, CancellationToken cancellationToken, bool migrateOffline = false)
    {
        Directory.CreateDirectory(root);
        var marker = Path.Combine(root, "encryption.state");
        if (File.Exists(marker))
        {
            var proof = await File.ReadAllTextAsync(marker, cancellationToken);
            if (!proof.StartsWith(DataEncryption.TextPrefix, StringComparison.Ordinal)
                || encryption.UnprotectText(proof, "directory:" + purpose) != "CyTask storage encryption v1")
                throw new CryptographicException("The storage encryption key does not match this folder.");
        }
        var paths = Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories).Where(include).ToArray();
        // Validate before replacing anything. Missing/wrong keys never create an empty workspace.
        foreach (var path in paths)
        {
            using var raw = File.OpenRead(path);
            var encrypted = EncryptedFileStream.HasHeader(raw);
            if (encrypted)
            {
                // A crashed writer may leave an uncommitted ciphertext temporary file.
                if (Path.GetExtension(path) is ".partial" or ".tmp") continue;
                using var validated = encryption.OpenFile(path, purpose);
                if (migrateOffline) await validated.CopyToAsync(Stream.Null, cancellationToken);
            }
            else if (encryption.Enabled && !migrateOffline)
                throw new InvalidOperationException("Existing folder content requires the offline --encrypt-storage --confirm-backup command. Back up the folder and key first.");
        }
        if (!encryption.Enabled) return;
        foreach (var path in paths)
        {
            bool encrypted;
            using (var raw = File.OpenRead(path)) encrypted = EncryptedFileStream.HasHeader(raw);
            if (!encrypted)
            {
                var temporary = path + "." + Guid.NewGuid().ToString("N") + ".encrypting";
                try
                {
                    await using (var source = File.OpenRead(path))
                    await using (var target = encryption.CreateFile(temporary, purpose))
                        await source.CopyToAsync(target, cancellationToken);
                    File.Move(temporary, path, true);
                }
                finally { File.Delete(temporary); }
            }
            if (migrateOffline && snapshotNames && path.Contains(Path.DirectorySeparatorChar + "snapshots" + Path.DirectorySeparatorChar, StringComparison.Ordinal)
                && Path.GetExtension(path) == ".json")
            {
                var name = Path.GetFileNameWithoutExtension(path);
                var separator = name.IndexOf('-', StringComparison.Ordinal);
                if (separator > 0)
                {
                    await using var source = File.OpenRead(path);
                    var hash = Convert.ToHexString(await SHA256.HashDataAsync(source, cancellationToken)).ToLowerInvariant();
                    await source.DisposeAsync();
                    var destination = Path.Combine(Path.GetDirectoryName(path)!, name[..separator] + "-" + hash + ".json");
                    if (destination != path) File.Move(path, destination, true);
                }
            }
        }
        if (!File.Exists(marker))
        {
            var temporary = marker + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                await File.WriteAllTextAsync(temporary, encryption.ProtectText("CyTask storage encryption v1", "directory:" + purpose), cancellationToken);
                File.Move(temporary, marker);
            }
            finally { File.Delete(temporary); }
        }
    }
}
