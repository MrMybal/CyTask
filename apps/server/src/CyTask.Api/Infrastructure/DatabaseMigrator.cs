using System.Reflection;
using Npgsql;

namespace CyTask.Api.Infrastructure;

public sealed class DatabaseMigrator(NpgsqlDataSource dataSource, ILogger<DatabaseMigrator> logger)
{
    private static readonly Action<ILogger, int, Exception?> LogApplyingMigration =
        LoggerMessage.Define<int>(
            LogLevel.Information,
            new EventId(1001, nameof(ApplyAsync)),
            "Applying database migration {Version}");

    public async Task ApplyAsync(CancellationToken cancellationToken)
    {
        var resources = Assembly.GetExecutingAssembly()
            .GetManifestResourceNames()
            .Where(name => name.Contains(".Database.Migrations.", StringComparison.Ordinal) &&
                           name.EndsWith(".sql", StringComparison.Ordinal))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var lockCommand = new NpgsqlCommand(
                         "SELECT pg_advisory_xact_lock(hashtext('cytask-schema-migrations'));",
                         connection,
                         transaction))
        {
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var tableCommand = new NpgsqlCommand(
                         "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());",
                         connection,
                         transaction))
        {
            await tableCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        foreach (var resource in resources)
        {
            var fileName = resource[(resource.LastIndexOf(".Migrations.", StringComparison.Ordinal) + 12)..];
            var separator = fileName.IndexOf('_', StringComparison.Ordinal);
            if (separator <= 0 || !int.TryParse(fileName[..separator], out var version))
            {
                throw new InvalidOperationException($"Migration resource name is invalid: {resource}");
            }

            await using var existsCommand = new NpgsqlCommand(
                "SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = @version);",
                connection,
                transaction);
            existsCommand.Parameters.AddWithValue("version", version);
            if ((bool)(await existsCommand.ExecuteScalarAsync(cancellationToken) ?? false))
            {
                continue;
            }

            await using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)
                ?? throw new InvalidOperationException($"Migration resource not found: {resource}");
            using var reader = new StreamReader(stream);
            var sql = await reader.ReadToEndAsync(cancellationToken);

            LogApplyingMigration(logger, version, null);
            await using var migrationCommand = new NpgsqlCommand(sql, connection, transaction);
            await migrationCommand.ExecuteNonQueryAsync(cancellationToken);

            await using var recordCommand = new NpgsqlCommand(
                "INSERT INTO schema_migrations(version) VALUES (@version) ON CONFLICT DO NOTHING;",
                connection,
                transaction);
            recordCommand.Parameters.AddWithValue("version", version);
            await recordCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }
}
