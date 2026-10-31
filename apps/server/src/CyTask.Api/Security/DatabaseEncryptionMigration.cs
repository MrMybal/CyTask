using System.Security.Cryptography;
using Npgsql;

namespace CyTask.Api.Security;

public sealed class DatabaseEncryptionMigration(NpgsqlDataSource dataSource, DataEncryption encryption)
{
    public async Task InitializeAsync(CancellationToken cancellationToken, bool migrateOffline = false)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var gate = new NpgsqlCommand("SELECT pg_advisory_xact_lock(hashtext('cytask-data-encryption'));", connection, transaction))
            await gate.ExecuteNonQueryAsync(cancellationToken);
        await using var state = new NpgsqlCommand("SELECT proof FROM data_encryption_state WHERE id=1", connection, transaction);
        var proof = await state.ExecuteScalarAsync(cancellationToken) as string;
        if (proof is not null)
        {
            if (!proof.StartsWith(DataEncryption.TextPrefix, StringComparison.Ordinal)
                || encryption.UnprotectText(proof, "database-state") != "CyTask storage encryption v1")
                throw new CryptographicException("The storage encryption key does not match this database.");
            await transaction.CommitAsync(cancellationToken); return;
        }
        if (!encryption.Enabled) { await transaction.CommitAsync(cancellationToken); return; }
        foreach (var (table, column, json) in EncryptedDatabase.Columns)
        {
            // Identifiers come only from the compile-time allowlist above, never user input.
            await using (var cursor = new NpgsqlCommand($"DECLARE cytask_encrypt_cursor NO SCROLL CURSOR FOR SELECT ctid::text, {column}::text FROM {table} WHERE {column} IS NOT NULL", connection, transaction))
                await cursor.ExecuteNonQueryAsync(cancellationToken);
            while (true)
            {
                var rows = new List<(string Id, string Value)>();
                await using (var fetch = new NpgsqlCommand("FETCH FORWARD 8 FROM cytask_encrypt_cursor", connection, transaction))
                await using (var reader = await fetch.ExecuteReaderAsync(cancellationToken))
                    while (await reader.ReadAsync(cancellationToken)) rows.Add((reader.GetString(0), reader.GetString(1)));
                if (rows.Count == 0) break;
                if (!migrateOffline)
                    throw new InvalidOperationException("Existing database content requires the offline --encrypt-storage --confirm-backup command. Back up the database and key first.");
                foreach (var (id, value) in rows)
                {
                    await using var update = new NpgsqlCommand($"UPDATE {table} SET {column}=@value{(json ? "::jsonb" : "")} WHERE ctid=@id::tid", connection, transaction);
                    update.Parameters.AddWithValue("value", encryption.Encode(value, json));
                    update.Parameters.AddWithValue("id", id);
                    await update.ExecuteNonQueryAsync(cancellationToken);
                }
            }
            await using var close = new NpgsqlCommand("CLOSE cytask_encrypt_cursor", connection, transaction);
            await close.ExecuteNonQueryAsync(cancellationToken);
        }
        await using var record = new NpgsqlCommand("INSERT INTO data_encryption_state(id,proof) VALUES(1,@proof)", connection, transaction);
        record.Parameters.AddWithValue("proof", encryption.ProtectText("CyTask storage encryption v1", "database-state"));
        await record.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
