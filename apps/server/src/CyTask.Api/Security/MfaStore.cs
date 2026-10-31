using System.Text.Json;
using Npgsql;

namespace CyTask.Api.Security;

public sealed class MfaAccount
{
    public long Version { get; set; }
    public string? TotpSecret { get; set; }
    public long LastTotpStep { get; set; } = -1;
    public bool EmailEnabled { get; set; }
    public List<string> RecoveryHashes { get; set; } = [];
    public Dictionary<string, MfaChallenge> Challenges { get; set; } = [];
    public Dictionary<string, MfaProof> Proofs { get; set; } = [];
    public int Failures { get; set; }
    public DateTimeOffset FailureWindow { get; set; }
    public DateTimeOffset? LastEmailAt { get; set; }
    public bool Enrolled => TotpSecret is not null || EmailEnabled;
}
public sealed class MfaChallenge
{
    public string Action { get; set; } = "login";
    public string Stage { get; set; } = "verify";
    public string Email { get; set; } = "";
    public long Version { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public int Attempts { get; set; }
    public string? SetupMethod { get; set; }
    public string? PendingSecret { get; set; }
    public string? EmailHash { get; set; }
    public string? EmailPurpose { get; set; }
    public DateTimeOffset? EmailExpiresAt { get; set; }
}
public sealed record MfaProof(long Version, DateTimeOffset ExpiresAt);
public interface IMfaStore
{
    Task<MfaAccount?> ReadAsync(Guid userId, CancellationToken cancellationToken);
    Task<T> UpdateAsync<T>(Guid userId, Func<MfaAccount,T> update, CancellationToken cancellationToken);
}
public sealed class InMemoryMfaStore : IMfaStore
{
    private readonly object _gate = new();
    private readonly Dictionary<Guid,MfaAccount> _accounts = [];
    public Task<MfaAccount?> ReadAsync(Guid userId, CancellationToken cancellationToken)
    {
        lock (_gate) return Task.FromResult(_accounts.TryGetValue(userId,out var state) ? Clone(state) : null);
    }
    public Task<T> UpdateAsync<T>(Guid userId, Func<MfaAccount,T> update, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var state=_accounts.TryGetValue(userId,out var stored) ? Clone(stored) : new();
            var result=update(state);_accounts[userId]=state;return Task.FromResult(result);
        }
    }
    private static MfaAccount Clone(MfaAccount state)=>JsonSerializer.Deserialize<MfaAccount>(JsonSerializer.Serialize(state))!;
}
public sealed class PostgresMfaStore(NpgsqlDataSource dataSource) : IMfaStore
{
    public async Task<MfaAccount?> ReadAsync(Guid userId,CancellationToken cancellationToken)
    {
        await using var command=dataSource.CreateCommand("SELECT data::text FROM account_mfa WHERE user_id=@id");
        command.Parameters.AddWithValue("id",userId);
        return await command.ExecuteScalarAsync(cancellationToken) is string json ? JsonSerializer.Deserialize<MfaAccount>(json) : null;
    }
    public async Task<T> UpdateAsync<T>(Guid userId,Func<MfaAccount,T> update,CancellationToken cancellationToken)
    {
        await using var connection=await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction=await connection.BeginTransactionAsync(cancellationToken);
        await using var ensure=new NpgsqlCommand("INSERT INTO account_mfa(user_id) VALUES(@id) ON CONFLICT DO NOTHING",connection,transaction);
        ensure.Parameters.AddWithValue("id",userId);await ensure.ExecuteNonQueryAsync(cancellationToken);
        await using var read=new NpgsqlCommand("SELECT data::text FROM account_mfa WHERE user_id=@id FOR UPDATE",connection,transaction);
        read.Parameters.AddWithValue("id",userId);var json=(string)(await read.ExecuteScalarAsync(cancellationToken))!;
        var state=JsonSerializer.Deserialize<MfaAccount>(json)!;var result=update(state);
        await using var write=new NpgsqlCommand("UPDATE account_mfa SET data=@data,updated_at=now() WHERE user_id=@id",connection,transaction);
        write.Parameters.AddWithValue("id",userId);write.Parameters.AddWithValue("data",NpgsqlTypes.NpgsqlDbType.Jsonb,JsonSerializer.Serialize(state));
        await write.ExecuteNonQueryAsync(cancellationToken);await transaction.CommitAsync(cancellationToken);return result;
    }
}
