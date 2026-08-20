using System.Data;
using System.Text.Json;
using CyTask.Api.Domain;
using Npgsql;

namespace CyTask.Api.Infrastructure;

public sealed class PostgresWorkspaceStore(NpgsqlDataSource dataSource) : IWorkspaceStore
{
    public async Task<bool> IsReadyAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var command = dataSource.CreateCommand("SELECT 1;");
            return await command.ExecuteScalarAsync(cancellationToken) is 1;
        }
        catch (NpgsqlException)
        {
            return false;
        }
    }

    public async Task<bool> HasUsersAsync(CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("SELECT EXISTS (SELECT 1 FROM users LIMIT 1);");
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    public async Task<BootstrapResult?> BootstrapAsync(
        string email,
        string displayName,
        string passwordHash,
        string organizationName,
        string organizationSlug,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);

        await using (var lockCommand = new NpgsqlCommand(
                         "SELECT pg_advisory_xact_lock(hashtext('cytask-bootstrap'));",
                         connection,
                         transaction))
        {
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var checkCommand = new NpgsqlCommand(
                         "SELECT EXISTS (SELECT 1 FROM users LIMIT 1);",
                         connection,
                         transaction))
        {
            if ((bool)(await checkCommand.ExecuteScalarAsync(cancellationToken) ?? false))
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }
        }

        var now = DateTimeOffset.UtcNow;
        var user = new UserAccount(Guid.CreateVersion7(), email, displayName, passwordHash, now);
        var organization = new Organization(Guid.CreateVersion7(), organizationName, organizationSlug, now);

        await ExecuteAsync(connection, transaction, """
            INSERT INTO organizations(id, name, slug, created_at)
            VALUES (@id, @name, @slug, @created_at);
            """, cancellationToken,
            ("id", organization.Id), ("name", organization.Name), ("slug", organization.Slug),
            ("created_at", organization.CreatedAt));

        await ExecuteAsync(connection, transaction, """
            INSERT INTO users(id, normalized_email, display_name, password_hash, created_at)
            VALUES (@id, @email, @display_name, @password_hash, @created_at);
            """, cancellationToken,
            ("id", user.Id), ("email", user.Email), ("display_name", user.DisplayName),
            ("password_hash", user.PasswordHash), ("created_at", user.CreatedAt));

        await ExecuteAsync(connection, transaction, """
            INSERT INTO organization_members(organization_id, user_id, role, created_at)
            VALUES (@organization_id, @user_id, 'owner', @created_at);
            """, cancellationToken,
            ("organization_id", organization.Id), ("user_id", user.Id), ("created_at", now));

        await InsertSessionAsync(
            connection, transaction, user.Id, organization.Id, sessionHash, csrfHash,
            sessionExpiresAt, now, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organization.Id, "organization.created", "organization",
            organization.Id, user.Id, user.DisplayName, $"Espace {organization.Name} créé", now,
            cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        var authenticated = new AuthenticatedUser(
            user.Id, organization.Id, user.Email, user.DisplayName, "owner", csrfHash, sessionExpiresAt);
        return new BootstrapResult(authenticated, sessionToken, csrfToken, organization);
    }

    public async Task<UserAccount?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, normalized_email, display_name, password_hash, created_at
            FROM users
            WHERE normalized_email = @email;
            """);
        command.Parameters.AddWithValue("email", normalizedEmail);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadUser(reader) : null;
    }

    public async Task<LoginResult?> CreateSessionAsync(
        Guid userId,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            SELECT u.normalized_email, u.display_name, m.organization_id, m.role
            FROM users u
            JOIN organization_members m ON m.user_id = u.id
            WHERE u.id = @user_id
            ORDER BY m.created_at
            LIMIT 1;
            """, connection, transaction);
        command.Parameters.AddWithValue("user_id", userId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var email = reader.GetString(0);
        var displayName = reader.GetString(1);
        var organizationId = reader.GetGuid(2);
        var role = reader.GetString(3);
        await reader.CloseAsync();

        var now = DateTimeOffset.UtcNow;
        await InsertSessionAsync(
            connection, transaction, userId, organizationId, sessionHash, csrfHash,
            sessionExpiresAt, now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        var authenticated = new AuthenticatedUser(
            userId, organizationId, email, displayName, role, csrfHash, sessionExpiresAt);
        return new LoginResult(authenticated, sessionToken, csrfToken);
    }

    public async Task<AuthenticatedUser?> FindSessionAsync(byte[] sessionHash, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT u.id, s.organization_id, u.normalized_email, u.display_name, m.role,
                   s.csrf_hash, s.expires_at
            FROM sessions s
            JOIN users u ON u.id = s.user_id
            JOIN organization_members m
              ON m.user_id = s.user_id AND m.organization_id = s.organization_id
            WHERE s.token_hash = @token_hash AND s.expires_at > now();
            """);
        command.Parameters.AddWithValue("token_hash", sessionHash);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AuthenticatedUser(
            reader.GetGuid(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.GetString(4),
            reader.GetFieldValue<byte[]>(5),
            reader.GetFieldValue<DateTimeOffset>(6));
    }

    public async Task DeleteSessionAsync(byte[] sessionHash, CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("DELETE FROM sessions WHERE token_hash = @token_hash;");
        command.Parameters.AddWithValue("token_hash", sessionHash);
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> CreateNativeAuthorizationAsync(
        Guid userId,
        Guid organizationId,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] codeHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await ExecuteAsync(connection, transaction, "DELETE FROM native_authorization_codes WHERE expires_at <= now();",
            cancellationToken);
        await ExecuteAsync(connection, transaction, "DELETE FROM native_access_tokens WHERE expires_at <= now();",
            cancellationToken);

        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        var inserted = await ExecuteAsync(connection, transaction, """
            INSERT INTO native_authorization_codes(
                id, code_hash, user_id, organization_id, client_id,
                redirect_uri, code_challenge, expires_at, created_at)
            SELECT
                @id, @code_hash, @user_id, @organization_id, @client_id,
                @redirect_uri, @code_challenge, @expires_at, @created_at
            WHERE EXISTS (
                SELECT 1 FROM organization_members
                WHERE organization_id = @organization_id AND user_id = @user_id
            );
            """, cancellationToken,
            ("id", id), ("code_hash", codeHash), ("user_id", userId),
            ("organization_id", organizationId), ("client_id", clientId),
            ("redirect_uri", redirectUri), ("code_challenge", codeChallenge),
            ("expires_at", expiresAt), ("created_at", now));
        if (inserted != 1)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        var actorName = await GetDisplayNameAsync(connection, transaction, userId, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "native.authorization.created",
            "native-authorization", id, userId, actorName,
            $"Autorisation native créée pour {clientId}", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<AuthenticatedUser?> RedeemNativeAuthorizationAsync(
        byte[] codeHash,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] accessTokenHash,
        DateTimeOffset accessTokenExpiresAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var redeem = new NpgsqlCommand("""
            DELETE FROM native_authorization_codes
            WHERE code_hash = @code_hash
              AND client_id = @client_id
              AND redirect_uri = @redirect_uri
              AND code_challenge = @code_challenge
              AND expires_at > now()
            RETURNING id, user_id, organization_id;
            """, connection, transaction);
        redeem.Parameters.AddWithValue("code_hash", codeHash);
        redeem.Parameters.AddWithValue("client_id", clientId);
        redeem.Parameters.AddWithValue("redirect_uri", redirectUri);
        redeem.Parameters.AddWithValue("code_challenge", codeChallenge);

        Guid authorizationId;
        Guid userId;
        Guid organizationId;
        await using (var reader = await redeem.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }
            authorizationId = reader.GetGuid(0);
            userId = reader.GetGuid(1);
            organizationId = reader.GetGuid(2);
        }

        await using var identity = new NpgsqlCommand("""
            SELECT u.normalized_email, u.display_name, m.role
            FROM users u
            JOIN organization_members m
              ON m.user_id = u.id AND m.organization_id = @organization_id
            WHERE u.id = @user_id;
            """, connection, transaction);
        identity.Parameters.AddWithValue("organization_id", organizationId);
        identity.Parameters.AddWithValue("user_id", userId);

        string email;
        string displayName;
        string role;
        await using (var reader = await identity.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }
            email = reader.GetString(0);
            displayName = reader.GetString(1);
            role = reader.GetString(2);
        }

        var now = DateTimeOffset.UtcNow;
        await ExecuteAsync(connection, transaction, """
            INSERT INTO native_access_tokens(
                id, token_hash, user_id, organization_id, client_id, expires_at, created_at)
            VALUES (
                @id, @token_hash, @user_id, @organization_id, @client_id, @expires_at, @created_at);
            """, cancellationToken,
            ("id", Guid.CreateVersion7()), ("token_hash", accessTokenHash), ("user_id", userId),
            ("organization_id", organizationId), ("client_id", clientId),
            ("expires_at", accessTokenExpiresAt), ("created_at", now));
        await InsertAuditAsync(
            connection, transaction, organizationId, "native.token.created",
            "native-authorization", authorizationId, userId, displayName,
            $"Accès natif créé pour {clientId}", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        return new AuthenticatedUser(
            userId, organizationId, email, displayName, role, [], accessTokenExpiresAt);
    }

    public async Task<AuthenticatedUser?> FindAccessTokenAsync(
        byte[] accessTokenHash,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT u.id, t.organization_id, u.normalized_email, u.display_name,
                   m.role, t.expires_at
            FROM native_access_tokens t
            JOIN users u ON u.id = t.user_id
            JOIN organization_members m
              ON m.user_id = t.user_id AND m.organization_id = t.organization_id
            WHERE t.token_hash = @token_hash AND t.expires_at > now();
            """);
        command.Parameters.AddWithValue("token_hash", accessTokenHash);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new AuthenticatedUser(
            reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
            reader.GetString(4), [], reader.GetFieldValue<DateTimeOffset>(5));
    }

    public async Task<CreatedApiToken?> CreateApiTokenAsync(
        Guid organizationId,
        Guid userId,
        string name,
        string scopes,
        string secret,
        byte[] tokenHash,
        DateTimeOffset? expiresAt,
        int maximumActiveTokens,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var tokenId = Guid.CreateVersion7();
        var createdAt = DateTimeOffset.UtcNow;
        await using (var command = new NpgsqlCommand("""
                         INSERT INTO api_tokens(
                             id, organization_id, user_id, name, token_hash, scopes, created_at, expires_at)
                         SELECT @id, @organization_id, @user_id, @name, @token_hash, @scopes, @created_at, @expires_at
                         WHERE (
                             SELECT count(*) FROM api_tokens
                             WHERE user_id = @user_id AND revoked_at IS NULL
                               AND (expires_at IS NULL OR expires_at > now())
                         ) < @maximum;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("id", tokenId);
            command.Parameters.AddWithValue("organization_id", organizationId);
            command.Parameters.AddWithValue("user_id", userId);
            command.Parameters.AddWithValue("name", name);
            command.Parameters.AddWithValue("token_hash", tokenHash);
            command.Parameters.AddWithValue("scopes", scopes);
            command.Parameters.AddWithValue("created_at", createdAt);
            command.Parameters.AddWithValue("expires_at", (object?)expiresAt ?? DBNull.Value);
            command.Parameters.AddWithValue("maximum", maximumActiveTokens);
            if (await command.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }
        }

        await InsertAuditAsync(
            connection, transaction, organizationId, "api_token.created", "api-token", tokenId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Jeton d’API « {name} » créé ({scopes})", createdAt, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new CreatedApiToken(
            new ApiToken(tokenId, name, scopes, createdAt, expiresAt, null, null), secret);
    }

    public async Task<IReadOnlyList<ApiToken>> ListApiTokensAsync(
        Guid organizationId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, name, scopes, created_at, expires_at, last_used_at, revoked_at
            FROM api_tokens
            WHERE organization_id = @organization_id AND user_id = @user_id
            ORDER BY created_at DESC;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("user_id", userId);
        var tokens = new List<ApiToken>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            tokens.Add(new ApiToken(
                reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                reader.GetFieldValue<DateTimeOffset>(3),
                reader.IsDBNull(4) ? null : reader.GetFieldValue<DateTimeOffset>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return tokens;
    }

    public async Task<bool> RevokeApiTokenAsync(
        Guid organizationId,
        Guid userId,
        Guid tokenId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        string? tokenName;
        await using (var command = new NpgsqlCommand("""
                         UPDATE api_tokens SET revoked_at = now()
                         WHERE id = @id AND organization_id = @organization_id
                           AND user_id = @user_id AND revoked_at IS NULL
                         RETURNING name;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("id", tokenId);
            command.Parameters.AddWithValue("organization_id", organizationId);
            command.Parameters.AddWithValue("user_id", userId);
            tokenName = (string?)await command.ExecuteScalarAsync(cancellationToken);
        }

        if (tokenName is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await InsertAuditAsync(
            connection, transaction, organizationId, "api_token.revoked", "api-token", tokenId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Jeton d’API « {tokenName} » révoqué", DateTimeOffset.UtcNow, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<ApiTokenPrincipal?> FindApiTokenAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE api_tokens t
            SET last_used_at = CASE
                WHEN t.last_used_at IS NULL OR t.last_used_at < now() - interval '1 minute'
                THEN now() ELSE t.last_used_at END
            FROM users u, organization_members m
            WHERE t.token_hash = @token_hash AND t.revoked_at IS NULL
              AND (t.expires_at IS NULL OR t.expires_at > now())
              AND u.id = t.user_id
              AND m.user_id = t.user_id AND m.organization_id = t.organization_id
            RETURNING u.id, t.organization_id, u.normalized_email, u.display_name,
                      m.role, COALESCE(t.expires_at, now() + interval '1 year'), t.scopes;
            """);
        command.Parameters.AddWithValue("token_hash", tokenHash);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new ApiTokenPrincipal(
            new AuthenticatedUser(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), [], reader.GetFieldValue<DateTimeOffset>(5)),
            reader.GetString(6));
    }

    public async Task DeleteAccessTokenAsync(byte[] accessTokenHash, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var command = new NpgsqlCommand("""
            DELETE FROM native_access_tokens
            WHERE token_hash = @token_hash
            RETURNING id, user_id, organization_id, client_id;
            """, connection, transaction);
        command.Parameters.AddWithValue("token_hash", accessTokenHash);

        Guid tokenId;
        Guid userId;
        Guid organizationId;
        string clientId;
        await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return;
            }
            tokenId = reader.GetGuid(0);
            userId = reader.GetGuid(1);
            organizationId = reader.GetGuid(2);
            clientId = reader.GetString(3);
        }

        var actorName = await GetDisplayNameAsync(connection, transaction, userId, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "native.token.revoked", "native-token",
            tokenId, userId, actorName, $"Accès natif révoqué pour {clientId}",
            DateTimeOffset.UtcNow, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<OrganizationMember>> ListMembersAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT u.id, u.normalized_email, u.display_name, m.role, m.created_at
            FROM organization_members m
            JOIN users u ON u.id = m.user_id
            WHERE m.organization_id = @organization_id
            ORDER BY lower(u.display_name), u.id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<OrganizationMember>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new OrganizationMember(
                reader.GetGuid(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetFieldValue<DateTimeOffset>(4)));
        }

        return result;
    }

    public async Task<CreatedInvitation?> CreateInvitationAsync(
        Guid organizationId,
        Guid createdBy,
        string email,
        string role,
        string token,
        byte[] tokenHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        var id = Guid.CreateVersion7();
        var now = DateTimeOffset.UtcNow;
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            await ExecuteAsync(connection, transaction, """
                UPDATE invitations
                SET revoked_at = @now
                WHERE organization_id = @organization_id AND normalized_email = @email
                  AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at <= @now;
                """, cancellationToken,
                ("now", now), ("organization_id", organizationId), ("email", email));

            var affected = await ExecuteAsync(connection, transaction, """
                INSERT INTO invitations(
                    id, organization_id, normalized_email, role, token_hash, created_by,
                    expires_at, created_at)
                SELECT @id, @organization_id, @email, @role, @token_hash, @created_by,
                       @expires_at, @created_at
                WHERE NOT EXISTS (
                    SELECT 1 FROM users WHERE normalized_email = @email
                ) AND EXISTS (
                    SELECT 1 FROM organization_members
                    WHERE organization_id = @organization_id AND user_id = @created_by
                      AND role IN ('owner', 'admin')
                      AND (role = 'owner' OR (role = 'admin' AND @role IN ('member', 'viewer')))
                );
                """, cancellationToken,
                ("id", id), ("organization_id", organizationId), ("email", email), ("role", role),
                ("token_hash", tokenHash), ("created_by", createdBy), ("expires_at", expiresAt),
                ("created_at", now));
            if (affected == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            await InsertOutboxAsync(connection, transaction, organizationId, "invitation.created", id,
                new { id, email, role, expiresAt }, cancellationToken);
            await InsertAuditAsync(
                connection, transaction, organizationId, "invitation.created", "invitation", id,
                createdBy, await GetDisplayNameAsync(connection, transaction, createdBy, cancellationToken),
                $"Invitation créée pour {email}", now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return new CreatedInvitation(id, email, role, token, expiresAt);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<InvitationPreview?> FindInvitationAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT o.name, i.normalized_email, i.role, i.expires_at
            FROM invitations i
            JOIN organizations o ON o.id = i.organization_id
            WHERE i.token_hash = @token_hash AND i.accepted_at IS NULL
              AND i.revoked_at IS NULL AND i.expires_at > now();
            """);
        command.Parameters.AddWithValue("token_hash", tokenHash);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? new InvitationPreview(
                reader.GetString(0),
                reader.GetString(1),
                reader.GetString(2),
                reader.GetFieldValue<DateTimeOffset>(3))
            : null;
    }

    public async Task<LoginResult?> AcceptInvitationAsync(
        byte[] tokenHash,
        string displayName,
        string passwordHash,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
            await using var invitationCommand = new NpgsqlCommand("""
                SELECT id, organization_id, normalized_email, role
                FROM invitations
                WHERE token_hash = @token_hash AND accepted_at IS NULL
                  AND revoked_at IS NULL AND expires_at > now()
                FOR UPDATE;
                """, connection, transaction);
            invitationCommand.Parameters.AddWithValue("token_hash", tokenHash);
            await using var reader = await invitationCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            var invitationId = reader.GetGuid(0);
            var organizationId = reader.GetGuid(1);
            var email = reader.GetString(2);
            var role = reader.GetString(3);
            await reader.CloseAsync();

            var now = DateTimeOffset.UtcNow;
            var user = new UserAccount(Guid.CreateVersion7(), email, displayName, passwordHash, now);
            await ExecuteAsync(connection, transaction, """
                INSERT INTO users(id, normalized_email, display_name, password_hash, created_at)
                VALUES (@id, @email, @display_name, @password_hash, @created_at);
                """, cancellationToken,
                ("id", user.Id), ("email", user.Email), ("display_name", user.DisplayName),
                ("password_hash", user.PasswordHash), ("created_at", user.CreatedAt));
            await ExecuteAsync(connection, transaction, """
                INSERT INTO organization_members(organization_id, user_id, role, created_at)
                VALUES (@organization_id, @user_id, @role, @created_at);
                """, cancellationToken,
                ("organization_id", organizationId), ("user_id", user.Id), ("role", role),
                ("created_at", now));
            await ExecuteAsync(connection, transaction, """
                UPDATE invitations SET accepted_at = @accepted_at WHERE id = @id;
                """, cancellationToken, ("accepted_at", now), ("id", invitationId));
            await InsertSessionAsync(
                connection, transaction, user.Id, organizationId, sessionHash, csrfHash,
                sessionExpiresAt, now, cancellationToken);
            await InsertOutboxAsync(connection, transaction, organizationId, "invitation.accepted", invitationId,
                new { invitationId, userId = user.Id, role }, cancellationToken);
            await InsertAuditAsync(
                connection, transaction, organizationId, "invitation.accepted", "member", user.Id,
                user.Id, user.DisplayName, $"{user.DisplayName} a rejoint l’espace", now, cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            var authenticated = new AuthenticatedUser(
                user.Id, organizationId, user.Email, user.DisplayName, role, csrfHash, sessionExpiresAt);
            return new LoginResult(authenticated, sessionToken, csrfToken);
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<ActivityEntry>> ListActivityAsync(
        Guid organizationId,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, event_type, aggregate_type, aggregate_id,
                   actor_id, actor_name, summary, created_at
            FROM audit_events
            WHERE organization_id = @organization_id
            ORDER BY created_at DESC, id DESC
            LIMIT @limit;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("limit", limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<ActivityEntry>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new ActivityEntry(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.GetGuid(4),
                reader.IsDBNull(5) ? null : reader.GetGuid(5),
                reader.GetString(6),
                reader.GetString(7),
                reader.GetFieldValue<DateTimeOffset>(8)));
        }

        return result;
    }

    public async Task<IReadOnlyList<SearchHit>> SearchAsync(
        Guid organizationId,
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT result_type, id, result_key, title, excerpt, updated_at
            FROM (
                SELECT 'project'::text AS result_type, p.id, p.project_key AS result_key,
                       p.name AS title, 'Projet'::text AS excerpt, p.created_at AS updated_at
                FROM projects p
                WHERE p.organization_id = @organization_id
                  AND (p.name ILIKE @pattern ESCAPE '\' OR p.project_key ILIKE @pattern ESCAPE '\')
                UNION ALL
                SELECT 'task'::text, t.id, p.project_key || '-' || t.task_number,
                       t.title, left(t.description, 160), t.updated_at
                FROM tasks t
                JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
                WHERE t.organization_id = @organization_id
                  AND (t.title ILIKE @pattern ESCAPE '\' OR t.description ILIKE @pattern ESCAPE '\'
                       OR (p.project_key || '-' || t.task_number) ILIKE @pattern ESCAPE '\')
            ) AS results
            ORDER BY updated_at DESC, id
            LIMIT @limit;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("pattern", $"%{EscapeLikePattern(query)}%");
        command.Parameters.AddWithValue("limit", limit);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<SearchHit>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(new SearchHit(
                reader.GetString(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                reader.GetString(4), reader.GetFieldValue<DateTimeOffset>(5)));
        }

        return result;
    }

    public async Task<WorkspaceExport?> ExportAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(IsolationLevel.RepeatableRead, cancellationToken);
        Organization? organization;
        await using (var organizationCommand = new NpgsqlCommand("""
                         SELECT id, name, slug, created_at
                         FROM organizations
                         WHERE id = @organization_id;
                         """, connection, transaction))
        {
            organizationCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await organizationCommand.ExecuteReaderAsync(cancellationToken);
            organization = await reader.ReadAsync(cancellationToken)
                ? new Organization(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2),
                    reader.GetFieldValue<DateTimeOffset>(3))
                : null;
        }

        if (organization is null)
        {
            return null;
        }

        var members = new List<OrganizationMember>();
        await using (var memberCommand = new NpgsqlCommand("""
                         SELECT u.id, u.normalized_email, u.display_name, m.role, m.created_at
                         FROM organization_members m
                         JOIN users u ON u.id = m.user_id
                         WHERE m.organization_id = @organization_id
                         ORDER BY m.created_at, u.id;
                         """, connection, transaction))
        {
            memberCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await memberCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                members.Add(new OrganizationMember(
                    reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
                    reader.GetFieldValue<DateTimeOffset>(4)));
            }
        }

        var projects = new List<Project>();
        await using (var projectCommand = new NpgsqlCommand("""
                         SELECT id, organization_id, name, project_key, next_task_number, created_by, created_at
                         FROM projects WHERE organization_id = @organization_id
                         ORDER BY created_at, id;
                         """, connection, transaction))
        {
            projectCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await projectCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                projects.Add(ReadProject(reader));
            }
        }

        var tasks = new List<WorkItem>();
        await using (var taskCommand = new NpgsqlCommand("""
                         SELECT t.id, t.organization_id, t.project_id, t.task_number, p.project_key,
                                t.title, t.description, t.status, t.priority, t.due_at,
                                t.assignee_id, au.display_name,
                                t.revision, t.created_by, t.created_at, t.updated_at
                         FROM tasks t
                         JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
                         LEFT JOIN users au ON au.id = t.assignee_id
                         WHERE t.organization_id = @organization_id
                         ORDER BY t.created_at, t.id;
                         """, connection, transaction))
        {
            taskCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await taskCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                tasks.Add(ReadTask(reader));
            }
        }

        var comments = new List<Comment>();
        await using (var commentCommand = new NpgsqlCommand("""
                         SELECT c.id, c.organization_id, c.task_id, c.author_id,
                                u.display_name, c.body, c.created_at
                         FROM comments c
                         JOIN users u ON u.id = c.author_id
                         WHERE c.organization_id = @organization_id
                         ORDER BY c.created_at, c.id;
                         """, connection, transaction))
        {
            commentCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await commentCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                comments.Add(ReadComment(reader));
            }
        }

        var activity = new List<ActivityEntry>();
        await using (var activityCommand = new NpgsqlCommand("""
                         SELECT id, organization_id, event_type, aggregate_type, aggregate_id,
                                actor_id, actor_name, summary, created_at
                         FROM audit_events
                         WHERE organization_id = @organization_id
                         ORDER BY created_at, id;
                         """, connection, transaction))
        {
            activityCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await activityCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                activity.Add(new ActivityEntry(
                    reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
                    reader.GetGuid(4), reader.IsDBNull(5) ? null : reader.GetGuid(5), reader.GetString(6),
                    reader.GetString(7), reader.GetFieldValue<DateTimeOffset>(8)));
            }
        }

        var attachments = new List<Attachment>();
        await using (var attachmentCommand = new NpgsqlCommand("""
                         SELECT id, organization_id, task_id, file_name, declared_content_type,
                                detected_content_type, size_bytes, sha256, status, optimized_locally,
                                created_by, created_at, rejection_reason, width, height, reviewed_at
                         FROM attachments
                         WHERE organization_id = @organization_id
                         ORDER BY created_at, id;
                         """, connection, transaction))
        {
            attachmentCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await attachmentCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                attachments.Add(ReadAttachment(reader));
            }
        }

        await transaction.CommitAsync(cancellationToken);
        return new WorkspaceExport(
            1, DateTimeOffset.UtcNow, organization, members, projects, tasks, comments, activity, attachments);
    }

    public async Task<IReadOnlyList<Attachment>?> ListAttachmentsAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, task_id, file_name, declared_content_type,
                   detected_content_type, size_bytes, sha256, status, optimized_locally,
                   created_by, created_at, rejection_reason, width, height, reviewed_at
            FROM attachments
            WHERE organization_id = @organization_id AND task_id = @task_id
            ORDER BY created_at, id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<Attachment>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(ReadAttachment(reader));
        }

        if (result.Count == 0 && !await TaskExistsAsync(organizationId, taskId, cancellationToken))
        {
            return null;
        }

        return result;
    }

    public async Task<AttachmentUpload?> CreateAttachmentUploadAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        Guid attachmentId,
        Guid uploadId,
        string fileName,
        string declaredContentType,
        long sizeBytes,
        string sha256,
        bool optimizedLocally,
        int chunkSizeBytes,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        await using (var lockCommand = new NpgsqlCommand(
                         "SELECT pg_advisory_xact_lock(hashtext(CAST(@user_id AS text)));",
                         connection,
                         transaction))
        {
            lockCommand.Parameters.AddWithValue("user_id", userId);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        var attachment = new Attachment(
            attachmentId, organizationId, taskId, fileName, declaredContentType, null,
            sizeBytes, sha256, "uploading", optimizedLocally, userId, now);
        var affected = await ExecuteAsync(connection, transaction, """
            INSERT INTO attachments(
                id, organization_id, task_id, file_name, declared_content_type,
                size_bytes, sha256, status, optimized_locally, created_by, created_at)
            SELECT @id, @organization_id, @task_id, @file_name, @declared_content_type,
                   @size_bytes, @sha256, 'uploading', @optimized_locally, @created_by, @created_at
            WHERE EXISTS (
                SELECT 1 FROM tasks
                WHERE id = @task_id AND organization_id = @organization_id
            ) AND EXISTS (
                SELECT 1 FROM organization_members
                WHERE organization_id = @organization_id AND user_id = @created_by
                  AND role IN ('owner', 'admin', 'member')
            ) AND (
                SELECT count(*)
                FROM attachment_uploads active_upload
                JOIN attachments active_attachment ON active_attachment.id = active_upload.attachment_id
                WHERE active_attachment.created_by = @created_by
                  AND active_upload.status = 'active' AND active_upload.expires_at > now()
            ) < 10;
            """, cancellationToken,
            ("id", attachment.Id), ("organization_id", organizationId), ("task_id", taskId),
            ("file_name", fileName), ("declared_content_type", declaredContentType),
            ("size_bytes", sizeBytes), ("sha256", sha256), ("optimized_locally", optimizedLocally),
            ("created_by", userId), ("created_at", now));
        if (affected == 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        await ExecuteAsync(connection, transaction, """
            INSERT INTO attachment_uploads(
                id, organization_id, attachment_id, chunk_size_bytes, status, expires_at, created_at)
            VALUES (@id, @organization_id, @attachment_id, @chunk_size_bytes, 'active', @expires_at, @created_at);
            """, cancellationToken,
            ("id", uploadId), ("organization_id", organizationId), ("attachment_id", attachmentId),
            ("chunk_size_bytes", chunkSizeBytes), ("expires_at", expiresAt), ("created_at", now));
        await InsertAuditAsync(
            connection, transaction, organizationId, "attachment.upload_started", "attachment", attachmentId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Envoi de {fileName} démarré", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AttachmentUpload(uploadId, attachment, chunkSizeBytes, expiresAt, "active", []);
    }

    public async Task<AttachmentUpload?> GetAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        Attachment attachment;
        int chunkSize;
        DateTimeOffset expiresAt;
        string uploadStatus;
        await using (var command = new NpgsqlCommand("""
                         SELECT a.id, a.organization_id, a.task_id, a.file_name, a.declared_content_type,
                                a.detected_content_type, a.size_bytes, a.sha256, a.status, a.optimized_locally,
                                a.created_by, a.created_at, a.rejection_reason, a.width, a.height, a.reviewed_at,
                                u.chunk_size_bytes, u.expires_at, u.status
                         FROM attachment_uploads u
                         JOIN attachments a ON a.id = u.attachment_id AND a.organization_id = u.organization_id
                         WHERE u.id = @upload_id AND u.organization_id = @organization_id
                           AND u.status = 'active' AND u.expires_at > now();
                         """, connection))
        {
            command.Parameters.AddWithValue("upload_id", uploadId);
            command.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return null;
            }

            attachment = ReadAttachment(reader);
            chunkSize = reader.GetInt32(16);
            expiresAt = reader.GetFieldValue<DateTimeOffset>(17);
            uploadStatus = reader.GetString(18);
        }

        var chunks = new List<UploadChunk>();
        await using (var chunkCommand = new NpgsqlCommand("""
                         SELECT chunk_index, size_bytes, sha256, created_at
                         FROM attachment_upload_chunks
                         WHERE upload_id = @upload_id
                         ORDER BY chunk_index;
                         """, connection))
        {
            chunkCommand.Parameters.AddWithValue("upload_id", uploadId);
            await using var reader = await chunkCommand.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                chunks.Add(new UploadChunk(
                    reader.GetInt32(0), reader.GetInt64(1), reader.GetString(2),
                    reader.GetFieldValue<DateTimeOffset>(3)));
            }
        }

        return new AttachmentUpload(uploadId, attachment, chunkSize, expiresAt, uploadStatus, chunks);
    }

    public async Task<RecordChunkResult> RecordAttachmentChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        long sizeBytes,
        string sha256,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        long attachmentSize;
        int chunkSize;
        await using (var lockCommand = new NpgsqlCommand("""
                         SELECT a.size_bytes, u.chunk_size_bytes
                         FROM attachment_uploads u
                         JOIN attachments a ON a.id = u.attachment_id AND a.organization_id = u.organization_id
                         WHERE u.id = @upload_id AND u.organization_id = @organization_id
                           AND u.status = 'active' AND u.expires_at > now()
                         FOR UPDATE OF u;
                         """, connection, transaction))
        {
            lockCommand.Parameters.AddWithValue("upload_id", uploadId);
            lockCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await lockCommand.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return new RecordChunkResult(RecordChunkStatus.NotFound, null);
            }

            attachmentSize = reader.GetInt64(0);
            chunkSize = reader.GetInt32(1);
        }

        await using (var existingCommand = new NpgsqlCommand("""
                         SELECT size_bytes, sha256, created_at
                         FROM attachment_upload_chunks
                         WHERE upload_id = @upload_id AND chunk_index = @chunk_index;
                         """, connection, transaction))
        {
            existingCommand.Parameters.AddWithValue("upload_id", uploadId);
            existingCommand.Parameters.AddWithValue("chunk_index", index);
            await using var reader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var existing = new UploadChunk(
                    index, reader.GetInt64(0), reader.GetString(1), reader.GetFieldValue<DateTimeOffset>(2));
                await transaction.RollbackAsync(cancellationToken);
                var status = existing.SizeBytes == sizeBytes && existing.Sha256 == sha256
                    ? RecordChunkStatus.AlreadyRecorded
                    : RecordChunkStatus.Conflict;
                return new RecordChunkResult(status, existing);
            }
        }

        long received;
        int count;
        await using (var progressCommand = new NpgsqlCommand("""
                         SELECT COALESCE(sum(size_bytes), 0), count(*)
                         FROM attachment_upload_chunks
                         WHERE upload_id = @upload_id;
                         """, connection, transaction))
        {
            progressCommand.Parameters.AddWithValue("upload_id", uploadId);
            await using var reader = await progressCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            received = reader.GetInt64(0);
            count = checked((int)reader.GetInt64(1));
        }

        var expectedSize = Math.Min(chunkSize, attachmentSize - received);
        if (index != count || sizeBytes != expectedSize || expectedSize <= 0)
        {
            await transaction.RollbackAsync(cancellationToken);
            return new RecordChunkResult(RecordChunkStatus.Conflict, null);
        }

        var chunk = new UploadChunk(index, sizeBytes, sha256, DateTimeOffset.UtcNow);
        await ExecuteAsync(connection, transaction, """
            INSERT INTO attachment_upload_chunks(upload_id, chunk_index, size_bytes, sha256, created_at)
            VALUES (@upload_id, @chunk_index, @size_bytes, @sha256, @created_at);
            """, cancellationToken,
            ("upload_id", uploadId), ("chunk_index", index), ("size_bytes", sizeBytes),
            ("sha256", sha256), ("created_at", chunk.CreatedAt));
        await transaction.CommitAsync(cancellationToken);
        return new RecordChunkResult(RecordChunkStatus.Recorded, chunk);
    }

    public async Task<Attachment?> CompleteAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string detectedContentType,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        Attachment? attachment;
        await using (var command = new NpgsqlCommand("""
                         UPDATE attachments a
                         SET detected_content_type = @detected_content_type, status = 'quarantined'
                         FROM attachment_uploads u
                         WHERE u.id = @upload_id AND u.organization_id = @organization_id
                           AND u.attachment_id = a.id AND u.status = 'active' AND u.expires_at > now()
                           AND (SELECT COALESCE(sum(c.size_bytes), 0)
                                FROM attachment_upload_chunks c WHERE c.upload_id = u.id) = a.size_bytes
                         RETURNING a.id, a.organization_id, a.task_id, a.file_name, a.declared_content_type,
                                   a.detected_content_type, a.size_bytes, a.sha256, a.status,
                                   a.optimized_locally, a.created_by, a.created_at, a.rejection_reason,
                                   a.width, a.height, a.reviewed_at;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("detected_content_type", detectedContentType);
            command.Parameters.AddWithValue("upload_id", uploadId);
            command.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            attachment = await reader.ReadAsync(cancellationToken) ? ReadAttachment(reader) : null;
        }

        if (attachment is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        await ExecuteAsync(connection, transaction, """
            UPDATE attachment_uploads SET status = 'completed' WHERE id = @upload_id;
            """, cancellationToken, ("upload_id", uploadId));
        await InsertAuditAsync(
            connection, transaction, organizationId, "attachment.quarantined", "attachment", attachment.Id,
            attachment.CreatedBy,
            await GetDisplayNameAsync(connection, transaction, attachment.CreatedBy, cancellationToken),
            $"{attachment.FileName} placé en quarantaine", DateTimeOffset.UtcNow, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return attachment;
    }

    public async Task RejectAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await ExecuteAsync(connection, transaction, """
            UPDATE attachments a SET status = 'rejected'
            FROM attachment_uploads u
            WHERE u.id = @upload_id AND u.organization_id = @organization_id
              AND u.attachment_id = a.id AND u.status = 'active';
            """, cancellationToken, ("upload_id", uploadId), ("organization_id", organizationId));
        await ExecuteAsync(connection, transaction, """
            UPDATE attachment_uploads SET status = 'rejected'
            WHERE id = @upload_id AND organization_id = @organization_id AND status = 'active';
            """, cancellationToken, ("upload_id", uploadId), ("organization_id", organizationId));
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<Attachment?> FindAttachmentAsync(
        Guid organizationId,
        Guid attachmentId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, task_id, file_name, declared_content_type,
                   detected_content_type, size_bytes, sha256, status, optimized_locally,
                   created_by, created_at, rejection_reason, width, height, reviewed_at
            FROM attachments
            WHERE id = @attachment_id AND organization_id = @organization_id;
            """);
        command.Parameters.AddWithValue("attachment_id", attachmentId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadAttachment(reader) : null;
    }

    public async Task<IReadOnlyList<PendingAttachmentReview>> ClaimAttachmentsForReviewAsync(
        int limit,
        DateTimeOffset leasedUntil,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            UPDATE attachments a
            SET review_attempts = a.review_attempts + 1, review_leased_until = @leased_until
            FROM (
                SELECT id FROM attachments
                WHERE status = 'quarantined'
                  AND (review_leased_until IS NULL OR review_leased_until < now())
                ORDER BY created_at, id
                LIMIT @limit
                FOR UPDATE SKIP LOCKED
            ) claimed
            WHERE a.id = claimed.id
            RETURNING a.id, a.organization_id, a.declared_content_type, a.review_attempts;
            """);
        command.Parameters.AddWithValue("leased_until", leasedUntil);
        command.Parameters.AddWithValue("limit", limit);
        var pending = new List<PendingAttachmentReview>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            pending.Add(new PendingAttachmentReview(
                reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetInt32(3)));
        }

        return pending;
    }

    public async Task<Attachment?> ApplyAttachmentReviewAsync(
        Guid organizationId,
        Guid attachmentId,
        AttachmentReview review,
        DateTimeOffset reviewedAt,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        Attachment? attachment;
        await using (var command = new NpgsqlCommand("""
                         UPDATE attachments
                         SET status = @status, detected_content_type = @detected_content_type,
                             width = @width, height = @height, rejection_reason = @rejection_reason,
                             reviewed_at = @reviewed_at, review_leased_until = NULL
                         WHERE id = @attachment_id AND organization_id = @organization_id
                           AND status = 'quarantined'
                         RETURNING id, organization_id, task_id, file_name, declared_content_type,
                                   detected_content_type, size_bytes, sha256, status, optimized_locally,
                                   created_by, created_at, rejection_reason, width, height, reviewed_at;
                         """, connection, transaction))
        {
            command.Parameters.AddWithValue("status", review.Accepted ? "available" : "rejected");
            command.Parameters.AddWithValue("detected_content_type", review.ContentType);
            command.Parameters.AddWithValue("width", (object?)review.Width ?? DBNull.Value);
            command.Parameters.AddWithValue("height", (object?)review.Height ?? DBNull.Value);
            command.Parameters.AddWithValue("rejection_reason", (object?)review.RejectionReason ?? DBNull.Value);
            command.Parameters.AddWithValue("reviewed_at", reviewedAt);
            command.Parameters.AddWithValue("attachment_id", attachmentId);
            command.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            attachment = await reader.ReadAsync(cancellationToken) ? ReadAttachment(reader) : null;
        }

        if (attachment is null)
        {
            await transaction.RollbackAsync(cancellationToken);
            return null;
        }

        var eventType = review.Accepted ? "attachment.available" : "attachment.rejected";
        await InsertAuditAsync(
            connection, transaction, organizationId, eventType, "attachment", attachment.Id,
            attachment.CreatedBy,
            await GetDisplayNameAsync(connection, transaction, attachment.CreatedBy, cancellationToken),
            review.Accepted
                ? $"{attachment.FileName} validé et disponible"
                : $"{attachment.FileName} refusé : {review.RejectionReason}",
            reviewedAt,
            cancellationToken);
        await InsertOutboxAsync(
            connection, transaction, organizationId, eventType, attachment.Id, attachment, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return attachment;
    }

    public async Task<IReadOnlyList<ExternalReference>?> ListExternalReferencesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, task_id, provider, repository, reference_type,
                   reference_value, label, web_url, created_by, created_at
            FROM external_references
            WHERE organization_id = @organization_id AND task_id = @task_id
            ORDER BY created_at, id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<ExternalReference>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(ReadExternalReference(reader));
        }

        if (result.Count == 0 && !await TaskExistsAsync(organizationId, taskId, cancellationToken))
        {
            return null;
        }

        return result;
    }

    public async Task<ExternalReference?> CreateExternalReferenceAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        string provider,
        string repository,
        string referenceType,
        string referenceValue,
        string label,
        string? webUrl,
        CancellationToken cancellationToken)
    {
        var reference = new ExternalReference(
            Guid.CreateVersion7(), organizationId, taskId, provider, repository,
            referenceType, referenceValue, label, webUrl, userId, DateTimeOffset.UtcNow);
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            var affected = await ExecuteAsync(connection, transaction, """
                INSERT INTO external_references(
                    id, organization_id, task_id, provider, repository, reference_type,
                    reference_value, label, web_url, created_by, created_at)
                SELECT @id, @organization_id, @task_id, @provider, @repository, @reference_type,
                       @reference_value, @label, NULLIF(@web_url, ''), @created_by, @created_at
                WHERE EXISTS (
                    SELECT 1 FROM tasks
                    WHERE id = @task_id AND organization_id = @organization_id
                ) AND EXISTS (
                    SELECT 1 FROM organization_members
                    WHERE organization_id = @organization_id AND user_id = @created_by
                      AND role IN ('owner', 'admin', 'member')
                );
                """, cancellationToken,
                ("id", reference.Id), ("organization_id", organizationId), ("task_id", taskId),
                ("provider", provider), ("repository", repository), ("reference_type", referenceType),
                ("reference_value", referenceValue), ("label", label),
                ("web_url", webUrl ?? string.Empty), ("created_by", userId),
                ("created_at", reference.CreatedAt));
            if (affected == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            await InsertOutboxAsync(
                connection, transaction, organizationId, "external_reference.created", reference.Id,
                reference, cancellationToken);
            await InsertAuditAsync(
                connection, transaction, organizationId, "external_reference.created", "task", taskId,
                userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
                $"Référence {referenceType} liée à une tâche", reference.CreatedAt, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return reference;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<Project>> ListProjectsAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT id, organization_id, name, project_key, next_task_number, created_by, created_at
            FROM projects
            WHERE organization_id = @organization_id
            ORDER BY lower(name), id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<Project>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(ReadProject(reader));
        }

        return result;
    }

    public async Task<Project?> CreateProjectAsync(
        Guid organizationId,
        Guid userId,
        string name,
        string key,
        CancellationToken cancellationToken)
    {
        var project = new Project(
            Guid.CreateVersion7(), organizationId, name, key, 1, userId, DateTimeOffset.UtcNow);
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
            await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
            var affected = await ExecuteAsync(connection, transaction, """
                INSERT INTO projects(id, organization_id, name, project_key, next_task_number, created_by, created_at)
                SELECT @id, @organization_id, @name, @project_key, 1, @created_by, @created_at
                WHERE EXISTS (
                    SELECT 1 FROM organization_members
                    WHERE organization_id = @organization_id AND user_id = @created_by
                      AND role IN ('owner', 'admin')
                );
                """, cancellationToken,
                ("id", project.Id), ("organization_id", project.OrganizationId), ("name", project.Name),
                ("project_key", project.Key), ("created_by", project.CreatedBy), ("created_at", project.CreatedAt));

            if (affected == 0)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            await InsertOutboxAsync(connection, transaction, organizationId, "project.created", project.Id, project, cancellationToken);
            await InsertAuditAsync(
                connection, transaction, organizationId, "project.created", "project", project.Id,
                userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
                $"Projet {project.Name} créé", project.CreatedAt, cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return project;
        }
        catch (PostgresException exception) when (exception.SqlState == PostgresErrorCodes.UniqueViolation)
        {
            return null;
        }
    }

    public async Task<IReadOnlyList<WorkItem>?> ListTasksAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT t.id, t.organization_id, t.project_id, t.task_number, p.project_key,
                   t.title, t.description, t.status, t.priority, t.due_at,
                   t.assignee_id, au.display_name,
                   t.revision, t.created_by, t.created_at, t.updated_at
            FROM tasks t
            JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
            LEFT JOIN users au ON au.id = t.assignee_id
            WHERE t.organization_id = @organization_id AND t.project_id = @project_id
            ORDER BY t.updated_at DESC, t.id;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("project_id", projectId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var result = new List<WorkItem>();
        while (await reader.ReadAsync(cancellationToken))
        {
            result.Add(ReadTask(reader));
        }

        if (result.Count == 0 && !await ProjectExistsAsync(organizationId, projectId, cancellationToken))
        {
            return null;
        }

        return result;
    }

    public async Task<WorkItem?> CreateTaskAsync(
        Guid organizationId,
        Guid projectId,
        Guid userId,
        string title,
        string description,
        string priority,
        DateTimeOffset? dueAt,
        Guid? assigneeId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using var projectCommand = new NpgsqlCommand("""
            UPDATE projects
            SET next_task_number = next_task_number + 1
            WHERE id = @project_id AND organization_id = @organization_id
              AND EXISTS (
                  SELECT 1 FROM organization_members
                  WHERE organization_id = @organization_id AND user_id = @user_id
                    AND role IN ('owner', 'admin', 'member')
              )
            RETURNING project_key, next_task_number - 1;
            """, connection, transaction);
        projectCommand.Parameters.AddWithValue("project_id", projectId);
        projectCommand.Parameters.AddWithValue("organization_id", organizationId);
        projectCommand.Parameters.AddWithValue("user_id", userId);
        await using var reader = await projectCommand.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        var projectKey = reader.GetString(0);
        var number = reader.GetInt32(1);
        await reader.CloseAsync();

        var now = DateTimeOffset.UtcNow;
        var task = new WorkItem(
            Guid.CreateVersion7(), organizationId, projectId, number, $"{projectKey}-{number}",
            title, description, "todo", priority, dueAt,
            assigneeId,
            assigneeId is Guid assignedUserId
                ? await GetDisplayNameAsync(connection, transaction, assignedUserId, cancellationToken)
                : null,
            1, userId, now, now);
        await ExecuteAsync(connection, transaction, """
            INSERT INTO tasks(
                id, organization_id, project_id, task_number, title, description, status, priority, due_at, assignee_id,
                revision, created_by, created_at, updated_at)
            VALUES (
                @id, @organization_id, @project_id, @task_number, @title, @description, @status, @priority, @due_at, @assignee_id,
                @revision, @created_by, @created_at, @updated_at);
            """, cancellationToken,
            ("id", task.Id), ("organization_id", task.OrganizationId), ("project_id", task.ProjectId),
            ("task_number", task.Number), ("title", task.Title), ("description", task.Description),
            ("status", task.Status), ("priority", task.Priority),
            ("due_at", (object?)task.DueAt ?? DBNull.Value),
            ("assignee_id", (object?)task.AssigneeId ?? DBNull.Value),
            ("revision", task.Revision), ("created_by", task.CreatedBy),
            ("created_at", task.CreatedAt), ("updated_at", task.UpdatedAt));
        await InsertOutboxAsync(connection, transaction, organizationId, "task.created", task.Id, task, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "task.created", "task", task.Id,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Tâche {task.Key} créée", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return task;
    }

    public async Task<TaskDetails?> GetTaskAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        WorkItem? task;
        await using (var taskCommand = new NpgsqlCommand("""
                         SELECT t.id, t.organization_id, t.project_id, t.task_number, p.project_key,
                                t.title, t.description, t.status, t.priority, t.due_at,
                                t.assignee_id, au.display_name,
                                t.revision, t.created_by, t.created_at, t.updated_at
                         FROM tasks t
                         JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
                         LEFT JOIN users au ON au.id = t.assignee_id
                         WHERE t.id = @task_id AND t.organization_id = @organization_id;
                         """, connection))
        {
            taskCommand.Parameters.AddWithValue("task_id", taskId);
            taskCommand.Parameters.AddWithValue("organization_id", organizationId);
            await using var reader = await taskCommand.ExecuteReaderAsync(cancellationToken);
            task = await reader.ReadAsync(cancellationToken) ? ReadTask(reader) : null;
        }

        if (task is null)
        {
            return null;
        }

        await using var commentCommand = new NpgsqlCommand("""
            SELECT c.id, c.organization_id, c.task_id, c.author_id, u.display_name, c.body, c.created_at
            FROM comments c
            JOIN users u ON u.id = c.author_id
            WHERE c.task_id = @task_id AND c.organization_id = @organization_id
            ORDER BY c.created_at, c.id;
            """, connection);
        commentCommand.Parameters.AddWithValue("task_id", taskId);
        commentCommand.Parameters.AddWithValue("organization_id", organizationId);
        await using var commentReader = await commentCommand.ExecuteReaderAsync(cancellationToken);
        var comments = new List<Comment>();
        while (await commentReader.ReadAsync(cancellationToken))
        {
            comments.Add(ReadComment(commentReader));
        }

        return new TaskDetails(task, comments);
    }

    public async Task<TaskDependencyOverview?> GetTaskDependenciesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        if (!await TaskExistsAsync(organizationId, taskId, cancellationToken))
        {
            return null;
        }

        await using var command = dataSource.CreateCommand("""
            SELECT relation_kind, related_id, project_id, project_key, task_number,
                   title, status, linked_at
            FROM (
                SELECT 0 AS relation_order, 'depends_on' AS relation_kind,
                       related.id AS related_id, related.project_id, project.project_key,
                       related.task_number, related.title, related.status, dependency.created_at AS linked_at
                FROM task_dependencies dependency
                JOIN tasks related
                  ON related.organization_id = dependency.organization_id
                 AND related.id = dependency.depends_on_task_id
                JOIN projects project ON project.id = related.project_id
                WHERE dependency.organization_id = @organization_id
                  AND dependency.task_id = @task_id

                UNION ALL

                SELECT 1 AS relation_order, 'blocking' AS relation_kind,
                       related.id AS related_id, related.project_id, project.project_key,
                       related.task_number, related.title, related.status, dependency.created_at AS linked_at
                FROM task_dependencies dependency
                JOIN tasks related
                  ON related.organization_id = dependency.organization_id
                 AND related.id = dependency.task_id
                JOIN projects project ON project.id = related.project_id
                WHERE dependency.organization_id = @organization_id
                  AND dependency.depends_on_task_id = @task_id
            ) relations
            ORDER BY relation_order, project_key, task_number;
            """);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var dependsOn = new List<TaskRelation>();
        var blocking = new List<TaskRelation>();
        while (await reader.ReadAsync(cancellationToken))
        {
            var relation = new TaskRelation(
                reader.GetGuid(1),
                reader.GetGuid(2),
                $"{reader.GetString(3)}-{reader.GetInt32(4)}",
                reader.GetString(5),
                reader.GetString(6),
                reader.GetFieldValue<DateTimeOffset>(7));
            (reader.GetString(0) == "depends_on" ? dependsOn : blocking).Add(relation);
        }

        return new TaskDependencyOverview(dependsOn, blocking);
    }

    public async Task<AddTaskDependencyResult> AddTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        if (taskId == dependsOnTaskId)
        {
            return new AddTaskDependencyResult(AddTaskDependencyStatus.SelfDependency, null);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        await using (var lockCommand = new NpgsqlCommand(
                         "SELECT pg_advisory_xact_lock(hashtextextended(CAST(@organization_id AS text), 0));",
                         connection,
                         transaction))
        {
            lockCommand.Parameters.AddWithValue("organization_id", organizationId);
            await lockCommand.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var accessCommand = new NpgsqlCommand("""
                         SELECT
                             (SELECT count(*) = 2 FROM tasks
                              WHERE organization_id = @organization_id
                                AND id IN (@task_id, @depends_on_task_id)),
                             EXISTS (
                                 SELECT 1 FROM organization_members
                                 WHERE organization_id = @organization_id AND user_id = @user_id
                                   AND role IN ('owner', 'admin', 'member')
                             );
                         """, connection, transaction))
        {
            accessCommand.Parameters.AddWithValue("organization_id", organizationId);
            accessCommand.Parameters.AddWithValue("task_id", taskId);
            accessCommand.Parameters.AddWithValue("depends_on_task_id", dependsOnTaskId);
            accessCommand.Parameters.AddWithValue("user_id", userId);
            await using var reader = await accessCommand.ExecuteReaderAsync(cancellationToken);
            await reader.ReadAsync(cancellationToken);
            if (!reader.GetBoolean(0) || !reader.GetBoolean(1))
            {
                await transaction.RollbackAsync(cancellationToken);
                return new AddTaskDependencyResult(AddTaskDependencyStatus.NotFound, null);
            }
        }

        await using (var existingCommand = new NpgsqlCommand("""
                         SELECT created_at FROM task_dependencies
                         WHERE organization_id = @organization_id
                           AND task_id = @task_id
                           AND depends_on_task_id = @depends_on_task_id;
                         """, connection, transaction))
        {
            existingCommand.Parameters.AddWithValue("organization_id", organizationId);
            existingCommand.Parameters.AddWithValue("task_id", taskId);
            existingCommand.Parameters.AddWithValue("depends_on_task_id", dependsOnTaskId);
            await using var existingReader = await existingCommand.ExecuteReaderAsync(cancellationToken);
            if (await existingReader.ReadAsync(cancellationToken))
            {
                var linkedAt = existingReader.GetFieldValue<DateTimeOffset>(0);
                await existingReader.CloseAsync();
                var relation = await ReadTaskRelationAsync(
                    connection, transaction, organizationId, dependsOnTaskId,
                    linkedAt, cancellationToken);
                await transaction.RollbackAsync(cancellationToken);
                return new AddTaskDependencyResult(AddTaskDependencyStatus.AlreadyExists, relation);
            }
        }

        await using (var cycleCommand = new NpgsqlCommand("""
                         WITH RECURSIVE dependency_path(depends_on_task_id) AS (
                             SELECT depends_on_task_id
                             FROM task_dependencies
                             WHERE organization_id = @organization_id
                               AND task_id = @depends_on_task_id
                             UNION
                             SELECT dependency.depends_on_task_id
                             FROM task_dependencies dependency
                             JOIN dependency_path path
                               ON dependency.task_id = path.depends_on_task_id
                             WHERE dependency.organization_id = @organization_id
                         )
                         SELECT EXISTS (
                             SELECT 1 FROM dependency_path WHERE depends_on_task_id = @task_id
                         );
                         """, connection, transaction))
        {
            cycleCommand.Parameters.AddWithValue("organization_id", organizationId);
            cycleCommand.Parameters.AddWithValue("task_id", taskId);
            cycleCommand.Parameters.AddWithValue("depends_on_task_id", dependsOnTaskId);
            if ((bool)(await cycleCommand.ExecuteScalarAsync(cancellationToken) ?? false))
            {
                await transaction.RollbackAsync(cancellationToken);
                return new AddTaskDependencyResult(AddTaskDependencyStatus.Cycle, null);
            }
        }

        var now = DateTimeOffset.UtcNow;
        await ExecuteAsync(connection, transaction, """
            INSERT INTO task_dependencies(
                organization_id, task_id, depends_on_task_id, created_by, created_at)
            VALUES (@organization_id, @task_id, @depends_on_task_id, @created_by, @created_at);

            UPDATE tasks
            SET revision = revision + 1, updated_at = @created_at
            WHERE organization_id = @organization_id AND id = @task_id;
            """, cancellationToken,
            ("organization_id", organizationId), ("task_id", taskId),
            ("depends_on_task_id", dependsOnTaskId), ("created_by", userId), ("created_at", now));
        var dependency = await ReadTaskRelationAsync(
            connection, transaction, organizationId, dependsOnTaskId, now, cancellationToken);
        await InsertOutboxAsync(
            connection, transaction, organizationId, "task.dependency_added", taskId, dependency, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "task.dependency_added", "task", taskId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Une dépendance vers {dependency?.Key ?? dependsOnTaskId.ToString()} a été ajoutée",
            now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new AddTaskDependencyResult(AddTaskDependencyStatus.Created, dependency);
    }

    public async Task<bool> RemoveTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var relation = await ReadTaskRelationAsync(
            connection, transaction, organizationId, dependsOnTaskId,
            DateTimeOffset.UtcNow, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var removed = await ExecuteAsync(connection, transaction, """
            DELETE FROM task_dependencies
            WHERE organization_id = @organization_id
              AND task_id = @task_id
              AND depends_on_task_id = @depends_on_task_id
              AND EXISTS (
                  SELECT 1 FROM organization_members
                  WHERE organization_id = @organization_id AND user_id = @user_id
                    AND role IN ('owner', 'admin', 'member')
              );
            """, cancellationToken,
            ("organization_id", organizationId), ("task_id", taskId),
            ("depends_on_task_id", dependsOnTaskId), ("user_id", userId)) > 0;
        if (!removed)
        {
            await transaction.RollbackAsync(cancellationToken);
            return false;
        }

        await ExecuteAsync(connection, transaction, """
            UPDATE tasks
            SET revision = revision + 1, updated_at = @updated_at
            WHERE organization_id = @organization_id AND id = @task_id;
            """, cancellationToken,
            ("organization_id", organizationId), ("task_id", taskId), ("updated_at", now));
        await InsertOutboxAsync(
            connection, transaction, organizationId, "task.dependency_removed", taskId, relation, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "task.dependency_removed", "task", taskId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"La dépendance vers {relation?.Key ?? dependsOnTaskId.ToString()} a été supprimée",
            now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<UpdateTaskResult> UpdateTaskAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        string title,
        string description,
        string status,
        string priority,
        DateTimeOffset? dueAt,
        Guid? assigneeId,
        long expectedRevision,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        await using var updateCommand = new NpgsqlCommand("""
            UPDATE tasks
            SET title = @title, description = @description, status = @status,
                priority = @priority, due_at = @due_at, assignee_id = @assignee_id,
                revision = revision + 1, updated_at = @updated_at
            WHERE id = @task_id AND organization_id = @organization_id
              AND revision = @expected_revision
              AND EXISTS (
                  SELECT 1 FROM organization_members
                  WHERE organization_id = @organization_id AND user_id = @user_id
                    AND role IN ('owner', 'admin', 'member')
              )
            RETURNING revision;
            """, connection, transaction);
        updateCommand.Parameters.AddWithValue("title", title);
        updateCommand.Parameters.AddWithValue("description", description);
        updateCommand.Parameters.AddWithValue("status", status);
        updateCommand.Parameters.AddWithValue("priority", priority);
        updateCommand.Parameters.AddWithValue("due_at", (object?)dueAt ?? DBNull.Value);
        updateCommand.Parameters.AddWithValue("assignee_id", (object?)assigneeId ?? DBNull.Value);
        updateCommand.Parameters.AddWithValue("updated_at", now);
        updateCommand.Parameters.AddWithValue("task_id", taskId);
        updateCommand.Parameters.AddWithValue("organization_id", organizationId);
        updateCommand.Parameters.AddWithValue("expected_revision", expectedRevision);
        updateCommand.Parameters.AddWithValue("user_id", userId);
        var updated = await updateCommand.ExecuteScalarAsync(cancellationToken) is not null;

        var current = await ReadTaskAsync(connection, transaction, organizationId, taskId, cancellationToken);
        if (!updated)
        {
            await transaction.RollbackAsync(cancellationToken);
            return current is null
                ? new UpdateTaskResult(UpdateTaskStatus.NotFound, null)
                : new UpdateTaskResult(UpdateTaskStatus.RevisionConflict, current);
        }

        await InsertOutboxAsync(connection, transaction, organizationId, "task.updated", taskId, current, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "task.updated", "task", taskId,
            userId, await GetDisplayNameAsync(connection, transaction, userId, cancellationToken),
            $"Tâche {current!.Key} mise à jour", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return new UpdateTaskResult(UpdateTaskStatus.Updated, current);
    }

    public async Task<Comment?> AddCommentAsync(
        Guid organizationId,
        Guid taskId,
        Guid authorId,
        string body,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        await using var updateCommand = new NpgsqlCommand("""
            UPDATE tasks
            SET revision = revision + 1, updated_at = @updated_at
            WHERE id = @task_id AND organization_id = @organization_id
              AND EXISTS (
                  SELECT 1 FROM organization_members
                  WHERE organization_id = @organization_id AND user_id = @author_id
                    AND role IN ('owner', 'admin', 'member')
              )
            RETURNING revision;
            """, connection, transaction);
        updateCommand.Parameters.AddWithValue("updated_at", now);
        updateCommand.Parameters.AddWithValue("task_id", taskId);
        updateCommand.Parameters.AddWithValue("organization_id", organizationId);
        updateCommand.Parameters.AddWithValue("author_id", authorId);
        if (await updateCommand.ExecuteScalarAsync(cancellationToken) is null)
        {
            return null;
        }

        await using var nameCommand = new NpgsqlCommand(
            "SELECT display_name FROM users WHERE id = @author_id;",
            connection,
            transaction);
        nameCommand.Parameters.AddWithValue("author_id", authorId);
        var authorName = (string?)await nameCommand.ExecuteScalarAsync(cancellationToken);
        if (authorName is null)
        {
            return null;
        }

        var comment = new Comment(
            Guid.CreateVersion7(), organizationId, taskId, authorId, authorName, body, now);
        await ExecuteAsync(connection, transaction, """
            INSERT INTO comments(id, organization_id, task_id, author_id, body, created_at)
            VALUES (@id, @organization_id, @task_id, @author_id, @body, @created_at);
            """, cancellationToken,
            ("id", comment.Id), ("organization_id", comment.OrganizationId), ("task_id", comment.TaskId),
            ("author_id", comment.AuthorId), ("body", comment.Body), ("created_at", comment.CreatedAt));
        await InsertOutboxAsync(connection, transaction, organizationId, "comment.created", taskId, comment, cancellationToken);
        await InsertAuditAsync(
            connection, transaction, organizationId, "comment.created", "task", taskId,
            authorId, authorName, $"Commentaire ajouté à la tâche", now, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return comment;
    }

    private async Task<bool> ProjectExistsAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT EXISTS (
                SELECT 1 FROM projects WHERE id = @project_id AND organization_id = @organization_id
            );
            """);
        command.Parameters.AddWithValue("project_id", projectId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private async Task<bool> TaskExistsAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var command = dataSource.CreateCommand("""
            SELECT EXISTS (
                SELECT 1 FROM tasks WHERE id = @task_id AND organization_id = @organization_id
            );
            """);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        return (bool)(await command.ExecuteScalarAsync(cancellationToken) ?? false);
    }

    private static async Task<TaskRelation?> ReadTaskRelationAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid organizationId,
        Guid taskId,
        DateTimeOffset linkedAt,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            SELECT task.id, task.project_id, project.project_key, task.task_number,
                   task.title, task.status
            FROM tasks task
            JOIN projects project ON project.id = task.project_id
            WHERE task.organization_id = @organization_id AND task.id = @task_id;
            """, connection, transaction);
        command.Parameters.AddWithValue("organization_id", organizationId);
        command.Parameters.AddWithValue("task_id", taskId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        if (!await reader.ReadAsync(cancellationToken))
        {
            return null;
        }

        return new TaskRelation(
            reader.GetGuid(0),
            reader.GetGuid(1),
            $"{reader.GetString(2)}-{reader.GetInt32(3)}",
            reader.GetString(4),
            reader.GetString(5),
            linkedAt);
    }

    private static async Task<WorkItem?> ReadTaskAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand("""
            SELECT t.id, t.organization_id, t.project_id, t.task_number, p.project_key,
                   t.title, t.description, t.status, t.priority, t.due_at,
                   t.assignee_id, au.display_name,
                   t.revision, t.created_by, t.created_at, t.updated_at
            FROM tasks t
            JOIN projects p ON p.id = t.project_id AND p.organization_id = t.organization_id
            LEFT JOIN users au ON au.id = t.assignee_id
            WHERE t.id = @task_id AND t.organization_id = @organization_id;
            """, connection, transaction);
        command.Parameters.AddWithValue("task_id", taskId);
        command.Parameters.AddWithValue("organization_id", organizationId);
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? ReadTask(reader) : null;
    }

    private static async Task InsertSessionAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid userId,
        Guid organizationId,
        byte[] sessionHash,
        byte[] csrfHash,
        DateTimeOffset expiresAt,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken)
    {
        await ExecuteAsync(connection, transaction, """
            INSERT INTO sessions(token_hash, csrf_hash, user_id, organization_id, expires_at, created_at)
            VALUES (@token_hash, @csrf_hash, @user_id, @organization_id, @expires_at, @created_at);
            """, cancellationToken,
            ("token_hash", sessionHash), ("csrf_hash", csrfHash), ("user_id", userId),
            ("organization_id", organizationId), ("expires_at", expiresAt), ("created_at", createdAt));
    }

    private static Task<int> InsertOutboxAsync<T>(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid organizationId,
        string eventType,
        Guid aggregateId,
        T payload,
        CancellationToken cancellationToken) =>
        ExecuteAsync(connection, transaction, """
            INSERT INTO outbox_events(id, organization_id, event_type, aggregate_id, payload, created_at)
            VALUES (@id, @organization_id, @event_type, @aggregate_id, CAST(@payload AS jsonb), @created_at);
            """, cancellationToken,
            ("id", Guid.CreateVersion7()), ("organization_id", organizationId), ("event_type", eventType),
            ("aggregate_id", aggregateId), ("payload", JsonSerializer.Serialize(payload)),
            ("created_at", DateTimeOffset.UtcNow));

    private static Task<int> InsertAuditAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid organizationId,
        string eventType,
        string aggregateType,
        Guid aggregateId,
        Guid actorId,
        string actorName,
        string summary,
        DateTimeOffset createdAt,
        CancellationToken cancellationToken) =>
        ExecuteAsync(connection, transaction, """
            INSERT INTO audit_events(
                id, organization_id, event_type, aggregate_type, aggregate_id,
                actor_id, actor_name, summary, created_at)
            VALUES (
                @id, @organization_id, @event_type, @aggregate_type, @aggregate_id,
                @actor_id, @actor_name, @summary, @created_at);
            """, cancellationToken,
            ("id", Guid.CreateVersion7()), ("organization_id", organizationId),
            ("event_type", eventType), ("aggregate_type", aggregateType),
            ("aggregate_id", aggregateId), ("actor_id", actorId),
            ("actor_name", actorName), ("summary", summary), ("created_at", createdAt));

    private static async Task<string> GetDisplayNameAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        Guid userId,
        CancellationToken cancellationToken)
    {
        await using var command = new NpgsqlCommand(
            "SELECT display_name FROM users WHERE id = @user_id;", connection, transaction);
        command.Parameters.AddWithValue("user_id", userId);
        return (string?)await command.ExecuteScalarAsync(cancellationToken) ?? "Utilisateur CyTask";
    }

    private static string EscapeLikePattern(string value) => value
        .Replace("\\", "\\\\", StringComparison.Ordinal)
        .Replace("%", "\\%", StringComparison.Ordinal)
        .Replace("_", "\\_", StringComparison.Ordinal);

    private static async Task<int> ExecuteAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string sql,
        CancellationToken cancellationToken,
        params (string Name, object Value)[] parameters)
    {
        await using var command = new NpgsqlCommand(sql, connection, transaction);
        foreach (var (name, value) in parameters)
        {
            command.Parameters.AddWithValue(name, value);
        }

        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static UserAccount ReadUser(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetString(1), reader.GetString(2), reader.GetString(3),
        reader.GetFieldValue<DateTimeOffset>(4));

    private static Project ReadProject(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetString(2), reader.GetString(3),
        reader.GetInt32(4), reader.GetGuid(5), reader.GetFieldValue<DateTimeOffset>(6));

    private static WorkItem ReadTask(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetInt32(3),
        $"{reader.GetString(4)}-{reader.GetInt32(3)}", reader.GetString(5), reader.GetString(6),
        reader.GetString(7), reader.GetString(8),
        reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9),
        reader.IsDBNull(10) ? null : reader.GetGuid(10),
        reader.IsDBNull(11) ? null : reader.GetString(11),
        reader.GetInt64(12), reader.GetGuid(13),
        reader.GetFieldValue<DateTimeOffset>(14), reader.GetFieldValue<DateTimeOffset>(15));

    private static Comment ReadComment(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetGuid(3),
        reader.GetString(4), reader.GetString(5), reader.GetFieldValue<DateTimeOffset>(6));

    private static Attachment ReadAttachment(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
        reader.GetString(4), reader.IsDBNull(5) ? null : reader.GetString(5), reader.GetInt64(6),
        reader.GetString(7), reader.GetString(8), reader.GetBoolean(9), reader.GetGuid(10),
        reader.GetFieldValue<DateTimeOffset>(11),
        reader.IsDBNull(12) ? null : reader.GetString(12),
        reader.IsDBNull(13) ? null : reader.GetInt32(13),
        reader.IsDBNull(14) ? null : reader.GetInt32(14),
        reader.IsDBNull(15) ? null : reader.GetFieldValue<DateTimeOffset>(15));

    private static ExternalReference ReadExternalReference(NpgsqlDataReader reader) => new(
        reader.GetGuid(0), reader.GetGuid(1), reader.GetGuid(2), reader.GetString(3),
        reader.GetString(4), reader.GetString(5), reader.GetString(6), reader.GetString(7),
        reader.IsDBNull(8) ? null : reader.GetString(8), reader.GetGuid(9),
        reader.GetFieldValue<DateTimeOffset>(10));
}
