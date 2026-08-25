using CyTask.Api.Domain;

namespace CyTask.Api.Infrastructure;

public sealed class InMemoryWorkspaceStore : IWorkspaceStore
{
    private readonly Lock _gate = new();
    private readonly Dictionary<Guid, UserAccount> _users = [];
    private readonly Dictionary<Guid, Organization> _organizations = [];
    private readonly Dictionary<Guid, (Guid UserId, Guid OrganizationId, string Role)> _memberships = [];
    private readonly Dictionary<string, SessionEntry> _sessions = new(StringComparer.Ordinal);
    private readonly Dictionary<string, NativeAuthorizationEntry> _nativeAuthorizations =
        new(StringComparer.Ordinal);
    private readonly Dictionary<string, AccessTokenEntry> _accessTokens = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ApiTokenEntry> _apiTokens = new(StringComparer.Ordinal);
    private readonly Dictionary<Guid, Project> _projects = [];
    private readonly Dictionary<Guid, ProjectLabel> _projectLabels = [];
    private readonly Dictionary<(Guid TaskId, Guid LabelId), TaskLabelAssignment> _taskLabelAssignments = [];
    private readonly Dictionary<Guid, WorkItem> _tasks = [];
    private readonly Dictionary<Guid, TaskParentAssignment> _taskParents = [];
    private readonly Dictionary<Guid, Comment> _comments = [];
    private readonly Dictionary<string, InvitationEntry> _invitations = new(StringComparer.Ordinal);
    private readonly List<ActivityEntry> _activities = [];
    private readonly Dictionary<Guid, Attachment> _attachments = [];
    private readonly Dictionary<Guid, AttachmentUpload> _attachmentUploads = [];
    private readonly Dictionary<Guid, (int Attempts, DateTimeOffset LeasedUntil)> _attachmentReviewLeases = [];
    private readonly Dictionary<Guid, ExternalReference> _externalReferences = [];
    private readonly Dictionary<(Guid TaskId, Guid DependsOnTaskId), TaskDependencyEntry> _taskDependencies = [];
    private readonly Dictionary<Guid, TaskChecklistItem> _checklistItems = [];

    public Task<bool> IsReadyAsync(CancellationToken cancellationToken) => Task.FromResult(true);

    public Task<bool> HasUsersAsync(CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            return Task.FromResult(_users.Count > 0);
        }
    }

    public Task<BootstrapResult?> BootstrapAsync(
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
        lock (_gate)
        {
            if (_users.Count > 0)
            {
                return Task.FromResult<BootstrapResult?>(null);
            }

            var now = DateTimeOffset.UtcNow;
            var user = new UserAccount(Guid.CreateVersion7(), email, displayName, passwordHash, now);
            var organization = new Organization(Guid.CreateVersion7(), organizationName, organizationSlug, now);
            var authenticated = new AuthenticatedUser(
                user.Id,
                organization.Id,
                user.Email,
                user.DisplayName,
                "owner",
                csrfHash,
                sessionExpiresAt);

            _users.Add(user.Id, user);
            _organizations.Add(organization.Id, organization);
            _memberships.Add(user.Id, (user.Id, organization.Id, "owner"));
            _sessions.Add(Convert.ToHexString(sessionHash), new SessionEntry(authenticated));
            AddActivity(
                organization.Id, "organization.created", "organization", organization.Id,
                user.Id, user.DisplayName, $"Espace {organization.Name} créé", now);

            return Task.FromResult<BootstrapResult?>(new(
                authenticated,
                sessionToken,
                csrfToken,
                organization));
        }
    }

    public Task<UserAccount?> FindUserByEmailAsync(string normalizedEmail, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            return Task.FromResult(_users.Values.SingleOrDefault(
                user => string.Equals(user.Email, normalizedEmail, StringComparison.Ordinal)));
        }
    }

    public Task<LoginResult?> CreateSessionAsync(
        Guid userId,
        string sessionToken,
        byte[] sessionHash,
        string csrfToken,
        byte[] csrfHash,
        DateTimeOffset sessionExpiresAt,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_users.TryGetValue(userId, out var user) ||
                !_memberships.TryGetValue(userId, out var membership))
            {
                return Task.FromResult<LoginResult?>(null);
            }

            var authenticated = new AuthenticatedUser(
                user.Id,
                membership.OrganizationId,
                user.Email,
                user.DisplayName,
                membership.Role,
                csrfHash,
                sessionExpiresAt);

            _sessions[Convert.ToHexString(sessionHash)] = new SessionEntry(authenticated);
            return Task.FromResult<LoginResult?>(new(authenticated, sessionToken, csrfToken));
        }
    }

    public Task<AuthenticatedUser?> FindSessionAsync(byte[] sessionHash, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = Convert.ToHexString(sessionHash);
            if (!_sessions.TryGetValue(key, out var session))
            {
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            if (session.User.SessionExpiresAt <= DateTimeOffset.UtcNow)
            {
                _sessions.Remove(key);
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            return Task.FromResult<AuthenticatedUser?>(session.User);
        }
    }

    public Task DeleteSessionAsync(byte[] sessionHash, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            _sessions.Remove(Convert.ToHexString(sessionHash));
            return Task.CompletedTask;
        }
    }

    public Task<bool> CreateNativeAuthorizationAsync(
        Guid userId,
        Guid organizationId,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] codeHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_users.TryGetValue(userId, out var user) ||
                !_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId)
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            foreach (var expired in _nativeAuthorizations
                         .Where(pair => pair.Value.ExpiresAt <= now)
                         .Select(pair => pair.Key)
                         .ToArray())
            {
                _nativeAuthorizations.Remove(expired);
            }
            foreach (var expired in _accessTokens
                         .Where(pair => pair.Value.ExpiresAt <= now)
                         .Select(pair => pair.Key)
                         .ToArray())
            {
                _accessTokens.Remove(expired);
            }

            var authorization = new NativeAuthorizationEntry(
                Guid.CreateVersion7(), userId, organizationId, clientId,
                redirectUri, codeChallenge, expiresAt, now);
            if (!_nativeAuthorizations.TryAdd(Convert.ToHexString(codeHash), authorization))
            {
                return Task.FromResult(false);
            }

            AddActivity(
                organizationId, "native.authorization.created", "native-authorization",
                authorization.Id, userId, user.DisplayName,
                $"Autorisation native créée pour {clientId}", now);
            return Task.FromResult(true);
        }
    }

    public Task<AuthenticatedUser?> RedeemNativeAuthorizationAsync(
        byte[] codeHash,
        string clientId,
        string redirectUri,
        string codeChallenge,
        byte[] accessTokenHash,
        DateTimeOffset accessTokenExpiresAt,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var codeKey = Convert.ToHexString(codeHash);
            if (!_nativeAuthorizations.TryGetValue(codeKey, out var authorization))
            {
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            if (authorization.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                _nativeAuthorizations.Remove(codeKey);
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            if (!string.Equals(authorization.ClientId, clientId, StringComparison.Ordinal) ||
                !string.Equals(authorization.RedirectUri, redirectUri, StringComparison.Ordinal) ||
                !string.Equals(authorization.CodeChallenge, codeChallenge, StringComparison.Ordinal) ||
                !_users.TryGetValue(authorization.UserId, out var user) ||
                !_memberships.TryGetValue(authorization.UserId, out var membership) ||
                membership.OrganizationId != authorization.OrganizationId)
            {
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            _nativeAuthorizations.Remove(codeKey);
            _accessTokens[Convert.ToHexString(accessTokenHash)] = new AccessTokenEntry(
                Guid.CreateVersion7(),
                authorization.UserId,
                authorization.OrganizationId,
                clientId,
                accessTokenExpiresAt,
                DateTimeOffset.UtcNow);
            AddActivity(
                authorization.OrganizationId, "native.token.created", "native-authorization",
                authorization.Id, authorization.UserId, user.DisplayName,
                $"Accès natif créé pour {clientId}", DateTimeOffset.UtcNow);

            return Task.FromResult<AuthenticatedUser?>(new AuthenticatedUser(
                user.Id,
                authorization.OrganizationId,
                user.Email,
                user.DisplayName,
                membership.Role,
                [],
                accessTokenExpiresAt));
        }
    }

    public Task<AuthenticatedUser?> FindAccessTokenAsync(
        byte[] accessTokenHash,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = Convert.ToHexString(accessTokenHash);
            if (!_accessTokens.TryGetValue(key, out var accessToken))
            {
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            if (accessToken.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                _accessTokens.Remove(key);
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            if (!_users.TryGetValue(accessToken.UserId, out var user) ||
                !_memberships.TryGetValue(accessToken.UserId, out var membership) ||
                membership.OrganizationId != accessToken.OrganizationId)
            {
                return Task.FromResult<AuthenticatedUser?>(null);
            }

            return Task.FromResult<AuthenticatedUser?>(new AuthenticatedUser(
                user.Id,
                accessToken.OrganizationId,
                user.Email,
                user.DisplayName,
                membership.Role,
                [],
                accessToken.ExpiresAt));
        }
    }

    public Task DeleteAccessTokenAsync(byte[] accessTokenHash, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = Convert.ToHexString(accessTokenHash);
            if (_accessTokens.Remove(key, out var accessToken) &&
                _users.TryGetValue(accessToken.UserId, out var user))
            {
                AddActivity(
                    accessToken.OrganizationId, "native.token.revoked", "native-token",
                    accessToken.Id, accessToken.UserId, user.DisplayName,
                    $"Accès natif révoqué pour {accessToken.ClientId}", DateTimeOffset.UtcNow);
            }
            return Task.CompletedTask;
        }
    }

    public Task<CreatedApiToken?> CreateApiTokenAsync(
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
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            var active = _apiTokens.Values.Count(entry =>
                entry.UserId == userId && entry.Token.RevokedAt is null &&
                (entry.Token.ExpiresAt is null || entry.Token.ExpiresAt > now));
            if (active >= maximumActiveTokens)
            {
                return Task.FromResult<CreatedApiToken?>(null);
            }

            var token = new ApiToken(Guid.CreateVersion7(), name, scopes, now, expiresAt, null, null);
            _apiTokens[Convert.ToHexString(tokenHash)] =
                new ApiTokenEntry(token, organizationId, userId);
            AddActivity(
                organizationId, "api_token.created", "api-token", token.Id,
                userId, _users[userId].DisplayName,
                $"Jeton d’API « {name} » créé ({scopes})", now);
            return Task.FromResult<CreatedApiToken?>(new CreatedApiToken(token, secret));
        }
    }

    public Task<IReadOnlyList<ApiToken>> ListApiTokensAsync(
        Guid organizationId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<ApiToken> result = _apiTokens.Values
                .Where(entry => entry.OrganizationId == organizationId && entry.UserId == userId)
                .Select(entry => entry.Token)
                .OrderByDescending(token => token.CreatedAt)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<bool> RevokeApiTokenAsync(
        Guid organizationId,
        Guid userId,
        Guid tokenId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var match = _apiTokens.FirstOrDefault(pair =>
                pair.Value.Token.Id == tokenId && pair.Value.OrganizationId == organizationId &&
                pair.Value.UserId == userId && pair.Value.Token.RevokedAt is null);
            if (match.Key is null)
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            _apiTokens[match.Key] = match.Value with
            {
                Token = match.Value.Token with { RevokedAt = now }
            };
            AddActivity(
                organizationId, "api_token.revoked", "api-token", tokenId,
                userId, _users[userId].DisplayName,
                $"Jeton d’API « {match.Value.Token.Name} » révoqué", now);
            return Task.FromResult(true);
        }
    }

    public Task<ApiTokenPrincipal?> FindApiTokenAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var key = Convert.ToHexString(tokenHash);
            var now = DateTimeOffset.UtcNow;
            if (!_apiTokens.TryGetValue(key, out var entry) || entry.Token.RevokedAt is not null ||
                (entry.Token.ExpiresAt is not null && entry.Token.ExpiresAt <= now) ||
                !_users.TryGetValue(entry.UserId, out var user) ||
                !_memberships.TryGetValue(entry.UserId, out var membership) ||
                membership.OrganizationId != entry.OrganizationId)
            {
                return Task.FromResult<ApiTokenPrincipal?>(null);
            }

            if (entry.Token.LastUsedAt is null || now - entry.Token.LastUsedAt > TimeSpan.FromMinutes(1))
            {
                _apiTokens[key] = entry with { Token = entry.Token with { LastUsedAt = now } };
            }

            var authenticated = new AuthenticatedUser(
                user.Id,
                entry.OrganizationId,
                user.Email,
                user.DisplayName,
                membership.Role,
                [],
                entry.Token.ExpiresAt ?? now.AddYears(1));
            return Task.FromResult<ApiTokenPrincipal?>(new ApiTokenPrincipal(authenticated, entry.Token.Scopes));
        }
    }

    public Task<IReadOnlyList<OrganizationMember>> ListMembersAsync(
        Guid organizationId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<OrganizationMember> result = _memberships.Values
                .Where(membership => membership.OrganizationId == organizationId)
                .Select(membership =>
                {
                    var user = _users[membership.UserId];
                    return new OrganizationMember(
                        user.Id,
                        user.Email,
                        user.DisplayName,
                        membership.Role,
                        user.CreatedAt);
                })
                .OrderBy(member => member.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<CreatedInvitation?> CreateInvitationAsync(
        Guid organizationId,
        Guid createdBy,
        string email,
        string role,
        string token,
        byte[] tokenHash,
        DateTimeOffset expiresAt,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(createdBy, out var actor) ||
                actor.OrganizationId != organizationId ||
                actor.Role is not ("owner" or "admin") ||
                role is not ("admin" or "member" or "viewer") ||
                _users.Values.Any(user => string.Equals(user.Email, email, StringComparison.Ordinal)) ||
                _invitations.Values.Any(invitation =>
                    invitation.OrganizationId == organizationId &&
                    string.Equals(invitation.Email, email, StringComparison.Ordinal) &&
                    invitation.AcceptedAt is null && invitation.RevokedAt is null &&
                    invitation.ExpiresAt > DateTimeOffset.UtcNow))
            {
                return Task.FromResult<CreatedInvitation?>(null);
            }

            var invitation = new InvitationEntry(
                Guid.CreateVersion7(),
                organizationId,
                email,
                role,
                createdBy,
                expiresAt,
                DateTimeOffset.UtcNow,
                null,
                null);
            _invitations.Add(Convert.ToHexString(tokenHash), invitation);
            AddActivity(
                organizationId, "invitation.created", "invitation", invitation.Id,
                createdBy, _users[createdBy].DisplayName, $"Invitation créée pour {email}", invitation.CreatedAt);
            return Task.FromResult<CreatedInvitation?>(new(
                invitation.Id, invitation.Email, invitation.Role, token, invitation.ExpiresAt));
        }
    }

    public Task<InvitationPreview?> FindInvitationAsync(
        byte[] tokenHash,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_invitations.TryGetValue(Convert.ToHexString(tokenHash), out var invitation) ||
                invitation.AcceptedAt is not null || invitation.RevokedAt is not null ||
                invitation.ExpiresAt <= DateTimeOffset.UtcNow ||
                !_organizations.TryGetValue(invitation.OrganizationId, out var organization))
            {
                return Task.FromResult<InvitationPreview?>(null);
            }

            return Task.FromResult<InvitationPreview?>(new(
                organization.Name, invitation.Email, invitation.Role, invitation.ExpiresAt));
        }
    }

    public Task<LoginResult?> AcceptInvitationAsync(
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
        lock (_gate)
        {
            var invitationKey = Convert.ToHexString(tokenHash);
            if (!_invitations.TryGetValue(invitationKey, out var invitation) ||
                invitation.AcceptedAt is not null || invitation.RevokedAt is not null ||
                invitation.ExpiresAt <= DateTimeOffset.UtcNow ||
                _users.Values.Any(user => string.Equals(user.Email, invitation.Email, StringComparison.Ordinal)))
            {
                return Task.FromResult<LoginResult?>(null);
            }

            var now = DateTimeOffset.UtcNow;
            var user = new UserAccount(
                Guid.CreateVersion7(), invitation.Email, displayName, passwordHash, now);
            var authenticated = new AuthenticatedUser(
                user.Id,
                invitation.OrganizationId,
                user.Email,
                user.DisplayName,
                invitation.Role,
                csrfHash,
                sessionExpiresAt);
            _users.Add(user.Id, user);
            _memberships.Add(user.Id, (user.Id, invitation.OrganizationId, invitation.Role));
            _sessions.Add(Convert.ToHexString(sessionHash), new SessionEntry(authenticated));
            _invitations[invitationKey] = invitation with { AcceptedAt = now };
            AddActivity(
                invitation.OrganizationId, "invitation.accepted", "member", user.Id,
                user.Id, user.DisplayName, $"{user.DisplayName} a rejoint l’espace", now);
            return Task.FromResult<LoginResult?>(new(authenticated, sessionToken, csrfToken));
        }
    }

    public Task<IReadOnlyList<ActivityEntry>> ListActivityAsync(
        Guid organizationId,
        int limit,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<ActivityEntry> result = _activities
                .Where(activity => activity.OrganizationId == organizationId)
                .OrderByDescending(activity => activity.CreatedAt)
                .ThenByDescending(activity => activity.Id)
                .Take(limit)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<IReadOnlyList<SearchHit>> SearchAsync(
        Guid organizationId,
        string query,
        int limit,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var hits = _projects.Values
                .Where(project => project.OrganizationId == organizationId &&
                    (project.Name.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                     project.Key.Contains(query, StringComparison.OrdinalIgnoreCase)))
                .Select(project => new SearchHit(
                    "project", project.Id, project.Key, project.Name, "Projet", project.CreatedAt))
                .Concat(_tasks.Values
                    .Where(task => task.OrganizationId == organizationId &&
                        (task.Title.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                         task.Description.Contains(query, StringComparison.OrdinalIgnoreCase) ||
                         task.Key.Contains(query, StringComparison.OrdinalIgnoreCase)))
                    .Select(task => new SearchHit(
                        "task", task.Id, task.Key, task.Title,
                        task.Description.Length <= 160 ? task.Description : $"{task.Description[..157]}…",
                        task.UpdatedAt)))
                .OrderByDescending(hit => hit.UpdatedAt)
                .Take(limit)
                .ToArray();
            return Task.FromResult<IReadOnlyList<SearchHit>>(hits);
        }
    }

    public Task<WorkspaceExport?> ExportAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_organizations.TryGetValue(organizationId, out var organization))
            {
                return Task.FromResult<WorkspaceExport?>(null);
            }

            var members = _memberships.Values
                .Where(membership => membership.OrganizationId == organizationId)
                .Select(membership =>
                {
                    var user = _users[membership.UserId];
                    return new OrganizationMember(
                        user.Id, user.Email, user.DisplayName, membership.Role, user.CreatedAt);
                })
                .OrderBy(member => member.DisplayName, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var projects = _projects.Values.Where(project => project.OrganizationId == organizationId).ToArray();
            var tasks = _tasks.Values.Where(task => task.OrganizationId == organizationId).ToArray();
            var comments = _comments.Values.Where(comment => comment.OrganizationId == organizationId).ToArray();
            var checklist = _checklistItems.Values
                .Where(item => item.OrganizationId == organizationId)
                .OrderBy(item => item.TaskId)
                .ThenBy(item => item.Position)
                .ThenBy(item => item.Id)
                .ToArray();
            var projectLabels = _projectLabels.Values
                .Where(label => label.OrganizationId == organizationId)
                .OrderBy(label => label.ProjectId)
                .ThenBy(label => label.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            var taskLabels = _taskLabelAssignments.Values
                .Where(assignment =>
                    _tasks.TryGetValue(assignment.TaskId, out var task)
                    && task.OrganizationId == organizationId)
                .OrderBy(assignment => assignment.TaskId)
                .ThenBy(assignment => assignment.LabelId)
                .ToArray();
            var taskParents = _taskParents.Values
                .Where(relation =>
                    _tasks.TryGetValue(relation.TaskId, out var task)
                    && task.OrganizationId == organizationId)
                .OrderBy(relation => relation.TaskId)
                .ToArray();

            var activity = _activities.Where(entry => entry.OrganizationId == organizationId).ToArray();
            var attachments = _attachments.Values
                .Where(attachment => attachment.OrganizationId == organizationId)
                .ToArray();
            return Task.FromResult<WorkspaceExport?>(new(
                4, DateTimeOffset.UtcNow, organization, members, projects, tasks, comments, checklist, projectLabels, taskLabels, taskParents, activity, attachments));
        }
    }

    public Task<IReadOnlyList<Attachment>?> ListAttachmentsAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult<IReadOnlyList<Attachment>?>(null);
            }

            IReadOnlyList<Attachment> result = _attachments.Values
                .Where(attachment => attachment.OrganizationId == organizationId && attachment.TaskId == taskId)
                .OrderBy(attachment => attachment.CreatedAt)
                .ToArray();
            return Task.FromResult<IReadOnlyList<Attachment>?>(result);
        }
    }

    public Task<IReadOnlyList<AttachmentUpload>?> ListAttachmentUploadsAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult<IReadOnlyList<AttachmentUpload>?>(null);
            }

            IReadOnlyList<AttachmentUpload> uploads = _attachmentUploads.Values
                .Where(upload =>
                    upload.Attachment.OrganizationId == organizationId &&
                    upload.Attachment.TaskId == taskId &&
                    upload.Attachment.CreatedBy == userId &&
                    upload.Status == "active" &&
                    upload.ExpiresAt > DateTimeOffset.UtcNow)
                .OrderBy(upload => upload.Attachment.CreatedAt)
                .ToArray();
            return Task.FromResult<IReadOnlyList<AttachmentUpload>?>(uploads);
        }
    }

    public Task<AttachmentUpload?> CreateAttachmentUploadAsync(
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
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId || membership.Role == "viewer" ||
                !_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId ||
                _attachmentUploads.Values.Count(upload =>
                    upload.Attachment.CreatedBy == userId && upload.Status == "active" &&
                    upload.ExpiresAt > DateTimeOffset.UtcNow) >= 10)
            {
                return Task.FromResult<AttachmentUpload?>(null);
            }

            var now = DateTimeOffset.UtcNow;
            var attachment = new Attachment(
                attachmentId, organizationId, taskId, fileName, declaredContentType, null,
                sizeBytes, sha256, "uploading", optimizedLocally, userId, now);
            var upload = new AttachmentUpload(
                uploadId, attachment, chunkSizeBytes, expiresAt, "active", []);
            _attachments.Add(attachment.Id, attachment);
            _attachmentUploads.Add(upload.Id, upload);
            AddActivity(
                organizationId, "attachment.upload_started", "attachment", attachment.Id,
                userId, _users[userId].DisplayName, $"Envoi de {fileName} démarré", now);
            return Task.FromResult<AttachmentUpload?>(upload);
        }
    }

    public Task<AttachmentUpload?> GetAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_attachmentUploads.TryGetValue(uploadId, out var upload) ||
                upload.Attachment.OrganizationId != organizationId || upload.Status != "active" ||
                upload.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                return Task.FromResult<AttachmentUpload?>(null);
            }

            return Task.FromResult<AttachmentUpload?>(upload);
        }
    }

    public Task<RecordChunkResult> RecordAttachmentChunkAsync(
        Guid organizationId,
        Guid uploadId,
        int index,
        long sizeBytes,
        string sha256,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_attachmentUploads.TryGetValue(uploadId, out var upload) ||
                upload.Attachment.OrganizationId != organizationId || upload.Status != "active" ||
                upload.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                return Task.FromResult(new RecordChunkResult(RecordChunkStatus.NotFound, null));
            }

            var existing = upload.Chunks.SingleOrDefault(chunk => chunk.Index == index);
            if (existing is not null)
            {
                var status = existing.SizeBytes == sizeBytes && existing.Sha256 == sha256
                    ? RecordChunkStatus.AlreadyRecorded
                    : RecordChunkStatus.Conflict;
                return Task.FromResult(new RecordChunkResult(status, existing));
            }

            var received = upload.Chunks.Sum(chunk => chunk.SizeBytes);
            var expectedSize = Math.Min(upload.ChunkSizeBytes, upload.Attachment.SizeBytes - received);
            if (index != upload.Chunks.Count || sizeBytes != expectedSize || expectedSize <= 0)
            {
                return Task.FromResult(new RecordChunkResult(RecordChunkStatus.Conflict, null));
            }

            var chunk = new UploadChunk(index, sizeBytes, sha256, DateTimeOffset.UtcNow);
            _attachmentUploads[uploadId] = upload with { Chunks = [.. upload.Chunks, chunk] };
            return Task.FromResult(new RecordChunkResult(RecordChunkStatus.Recorded, chunk));
        }
    }

    public Task<Attachment?> CompleteAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        string detectedContentType,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_attachmentUploads.TryGetValue(uploadId, out var upload) ||
                upload.Attachment.OrganizationId != organizationId || upload.Status != "active" ||
                upload.Chunks.Sum(chunk => chunk.SizeBytes) != upload.Attachment.SizeBytes)
            {
                return Task.FromResult<Attachment?>(null);
            }

            var attachment = upload.Attachment with
            {
                DetectedContentType = detectedContentType,
                Status = "quarantined"
            };
            _attachments[attachment.Id] = attachment;
            _attachmentUploads[uploadId] = upload with { Attachment = attachment, Status = "completed" };
            AddActivity(
                organizationId, "attachment.quarantined", "attachment", attachment.Id,
                attachment.CreatedBy, _users[attachment.CreatedBy].DisplayName,
                $"{attachment.FileName} placé en quarantaine", DateTimeOffset.UtcNow);
            return Task.FromResult<Attachment?>(attachment);
        }
    }

    public Task RejectAttachmentUploadAsync(
        Guid organizationId,
        Guid uploadId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (_attachmentUploads.TryGetValue(uploadId, out var upload) &&
                upload.Attachment.OrganizationId == organizationId && upload.Status == "active")
            {
                var attachment = upload.Attachment with { Status = "rejected" };
                _attachments[attachment.Id] = attachment;
                _attachmentUploads[uploadId] = upload with { Attachment = attachment, Status = "rejected" };
            }

            return Task.CompletedTask;
        }
    }

    public Task<Attachment?> FindAttachmentAsync(
        Guid organizationId,
        Guid attachmentId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            return Task.FromResult(
                _attachments.TryGetValue(attachmentId, out var attachment) &&
                attachment.OrganizationId == organizationId
                    ? attachment
                    : null);
        }
    }

    public Task<IReadOnlyList<PendingAttachmentReview>> ClaimAttachmentsForReviewAsync(
        int limit,
        DateTimeOffset leasedUntil,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            var now = DateTimeOffset.UtcNow;
            var claimed = new List<PendingAttachmentReview>();
            foreach (var attachment in _attachments.Values
                         .Where(candidate => candidate.Status == "quarantined")
                         .OrderBy(candidate => candidate.CreatedAt)
                         .ThenBy(candidate => candidate.Id)
                         .Take(limit))
            {
                var lease = _attachmentReviewLeases.GetValueOrDefault(attachment.Id);
                if (lease.LeasedUntil > now)
                {
                    continue;
                }

                _attachmentReviewLeases[attachment.Id] = (lease.Attempts + 1, leasedUntil);
                claimed.Add(new PendingAttachmentReview(
                    attachment.Id, attachment.OrganizationId, attachment.DeclaredContentType, lease.Attempts + 1));
            }

            return Task.FromResult<IReadOnlyList<PendingAttachmentReview>>(claimed);
        }
    }

    public Task<Attachment?> ApplyAttachmentReviewAsync(
        Guid organizationId,
        Guid attachmentId,
        AttachmentReview review,
        DateTimeOffset reviewedAt,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_attachments.TryGetValue(attachmentId, out var attachment) ||
                attachment.OrganizationId != organizationId || attachment.Status != "quarantined")
            {
                return Task.FromResult<Attachment?>(null);
            }

            var reviewed = attachment with
            {
                Status = review.Accepted ? "available" : "rejected",
                DetectedContentType = review.ContentType,
                Width = review.Width,
                Height = review.Height,
                RejectionReason = review.RejectionReason,
                ReviewedAt = reviewedAt,
                DurationSeconds = review.DurationSeconds
            };
            _attachments[attachmentId] = reviewed;
            _attachmentReviewLeases.Remove(attachmentId);
            AddActivity(
                organizationId,
                review.Accepted ? "attachment.available" : "attachment.rejected",
                "attachment",
                attachmentId,
                reviewed.CreatedBy,
                _users[reviewed.CreatedBy].DisplayName,
                review.Accepted
                    ? $"{reviewed.FileName} validé et disponible"
                    : $"{reviewed.FileName} refusé : {review.RejectionReason}",
                reviewedAt);
            return Task.FromResult<Attachment?>(reviewed);
        }
    }

    public Task<IReadOnlyList<ExternalReference>?> ListExternalReferencesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult<IReadOnlyList<ExternalReference>?>(null);
            }

            IReadOnlyList<ExternalReference> result = _externalReferences.Values
                .Where(reference => reference.OrganizationId == organizationId && reference.TaskId == taskId)
                .OrderBy(reference => reference.CreatedAt)
                .ToArray();
            return Task.FromResult<IReadOnlyList<ExternalReference>?>(result);
        }
    }

    public Task<ExternalReference?> CreateExternalReferenceAsync(
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
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId || membership.Role == "viewer" ||
                !_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId ||
                _externalReferences.Values.Any(reference =>
                    reference.TaskId == taskId && reference.Provider == provider &&
                    reference.Repository == repository && reference.ReferenceType == referenceType &&
                    reference.ReferenceValue == referenceValue))
            {
                return Task.FromResult<ExternalReference?>(null);
            }

            var reference = new ExternalReference(
                Guid.CreateVersion7(), organizationId, taskId, provider, repository,
                referenceType, referenceValue, label, webUrl, userId, DateTimeOffset.UtcNow);
            _externalReferences.Add(reference.Id, reference);
            AddActivity(
                organizationId, "external_reference.created", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Référence {referenceType} liée à {task.Key}", reference.CreatedAt);
            return Task.FromResult<ExternalReference?>(reference);
        }
    }

    public Task<IReadOnlyList<Project>> ListProjectsAsync(Guid organizationId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            IReadOnlyList<Project> result = _projects.Values
                .Where(project => project.OrganizationId == organizationId)
                .OrderBy(project => project.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray();
            return Task.FromResult(result);
        }
    }

    public Task<Project?> CreateProjectAsync(
        Guid organizationId,
        Guid userId,
        string name,
        string key,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId ||
                membership.Role is not ("owner" or "admin") ||
                !_organizations.ContainsKey(organizationId) ||
                _projects.Values.Any(project =>
                    project.OrganizationId == organizationId &&
                    string.Equals(project.Key, key, StringComparison.OrdinalIgnoreCase)))
            {
                return Task.FromResult<Project?>(null);
            }

            var project = new Project(
                Guid.CreateVersion7(), organizationId, name, key, 1, userId, DateTimeOffset.UtcNow);
            _projects.Add(project.Id, project);
            AddActivity(
                organizationId, "project.created", "project", project.Id,
                userId, _users[userId].DisplayName, $"Projet {project.Name} créé", project.CreatedAt);
            return Task.FromResult<Project?>(project);
        }
    }

    public Task<ProjectLabelOverview?> GetProjectLabelsAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId)
            {
                return Task.FromResult<ProjectLabelOverview?>(null);
            }

            IReadOnlyList<ProjectLabel> labels = _projectLabels.Values
                .Where(label => label.OrganizationId == organizationId && label.ProjectId == projectId)
                .OrderBy(label => label.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(label => label.Id)
                .ToArray();
            var labelIds = labels.Select(label => label.Id).ToHashSet();
            IReadOnlyList<TaskLabelAssignment> assignments = _taskLabelAssignments.Values
                .Where(assignment =>
                    labelIds.Contains(assignment.LabelId)
                    && _tasks.TryGetValue(assignment.TaskId, out var task)
                    && task.ProjectId == projectId)
                .OrderBy(assignment => assignment.TaskId)
                .ThenBy(assignment => assignment.LabelId)
                .ToArray();
            return Task.FromResult<ProjectLabelOverview?>(new(labels, assignments));
        }
    }

    public Task<ProjectLabel?> CreateProjectLabelAsync(
        Guid organizationId,
        Guid projectId,
        Guid userId,
        string name,
        string color,
        Guid? parentLabelId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId
                || _projectLabels.Values.Count(label =>
                    label.OrganizationId == organizationId && label.ProjectId == projectId) >= 64
                || _projectLabels.Values.Any(label =>
                    label.OrganizationId == organizationId
                    && label.ProjectId == projectId
                    && string.Equals(label.Name, name, StringComparison.OrdinalIgnoreCase))
                || (parentLabelId is Guid parentId
                    && (!_projectLabels.TryGetValue(parentId, out var parentLabel)
                        || parentLabel.OrganizationId != organizationId
                        || parentLabel.ProjectId != projectId)))
            {
                return Task.FromResult<ProjectLabel?>(null);
            }

            var label = new ProjectLabel(
                Guid.CreateVersion7(),
                organizationId,
                projectId,
                name,
                color,
                userId,
                DateTimeOffset.UtcNow,
                parentLabelId);
            _projectLabels.Add(label.Id, label);
            AddActivity(
                organizationId, "project.label_created", "project", projectId,
                userId, _users[userId].DisplayName,
                $"Label « {label.Name} » créé dans {project.Key}", label.CreatedAt);
            return Task.FromResult<ProjectLabel?>(label);
        }
    }

    public Task<bool> DeleteProjectLabelAsync(
        Guid organizationId,
        Guid projectId,
        Guid labelId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || (membership.Role != "owner" && membership.Role != "admin")
                || !_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId
                || !_projectLabels.TryGetValue(labelId, out var label)
                || label.OrganizationId != organizationId
                || label.ProjectId != projectId)
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            var assignments = _taskLabelAssignments.Keys
                .Where(key => key.LabelId == labelId)
                .ToArray();
            foreach (var assignment in assignments)
            {
                _taskLabelAssignments.Remove(assignment);
                if (_tasks.TryGetValue(assignment.TaskId, out var task))
                {
                    _tasks[task.Id] = task with { Revision = task.Revision + 1, UpdatedAt = now };
                }
            }

            foreach (var child in _projectLabels.Values
                         .Where(candidate => candidate.ParentLabelId == labelId)
                         .ToArray())
            {
                _projectLabels[child.Id] = child with { ParentLabelId = null };
            }
            _projectLabels.Remove(labelId);
            AddActivity(
                organizationId, "project.label_deleted", "project", projectId,
                userId, _users[userId].DisplayName,
                $"Label « {label.Name} » supprimé de {project.Key}", now);
            return Task.FromResult(true);
        }
    }

    public Task<AddTaskLabelResult> AddTaskLabelAsync(
        Guid organizationId,
        Guid taskId,
        Guid labelId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_projectLabels.TryGetValue(labelId, out var label)
                || label.OrganizationId != organizationId
                || label.ProjectId != task.ProjectId)
            {
                return Task.FromResult(new AddTaskLabelResult(AddTaskLabelStatus.NotFound, null));
            }

            if (_taskLabelAssignments.TryGetValue((taskId, labelId), out var existing))
            {
                return Task.FromResult(new AddTaskLabelResult(
                    AddTaskLabelStatus.AlreadyExists, existing));
            }

            var now = DateTimeOffset.UtcNow;
            var assignment = new TaskLabelAssignment(taskId, labelId, userId, now);
            _taskLabelAssignments.Add((taskId, labelId), assignment);
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.label_added", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Label « {label.Name} » ajouté à {task.Key}", now);
            return Task.FromResult(new AddTaskLabelResult(AddTaskLabelStatus.Created, assignment));
        }
    }

    public Task<bool> RemoveTaskLabelAsync(
        Guid organizationId,
        Guid taskId,
        Guid labelId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_projectLabels.TryGetValue(labelId, out var label)
                || label.OrganizationId != organizationId
                || label.ProjectId != task.ProjectId
                || !_taskLabelAssignments.Remove((taskId, labelId)))
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.label_removed", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Label « {label.Name} » retiré de {task.Key}", now);
            return Task.FromResult(true);
        }
    }

    public Task<ProjectTaskHierarchy?> GetProjectTaskHierarchyAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId)
            {
                return Task.FromResult<ProjectTaskHierarchy?>(null);
            }

            IReadOnlyList<TaskParentAssignment> relations = _taskParents.Values
                .Where(relation =>
                    _tasks.TryGetValue(relation.TaskId, out var task)
                    && task.OrganizationId == organizationId
                    && task.ProjectId == projectId)
                .OrderBy(relation => relation.TaskId)
                .ToArray();
            return Task.FromResult<ProjectTaskHierarchy?>(new(relations));
        }
    }

    public Task<SetTaskParentResult> SetTaskParentAsync(
        Guid organizationId,
        Guid taskId,
        Guid parentTaskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_tasks.TryGetValue(parentTaskId, out var parent)
                || parent.OrganizationId != organizationId
                || parent.ProjectId != task.ProjectId)
            {
                return Task.FromResult(new SetTaskParentResult(SetTaskParentStatus.NotFound, null));
            }

            if (taskId == parentTaskId)
            {
                return Task.FromResult(new SetTaskParentResult(SetTaskParentStatus.SelfParent, null));
            }

            if (_taskParents.TryGetValue(taskId, out var existing)
                && existing.ParentTaskId == parentTaskId)
            {
                return Task.FromResult(new SetTaskParentResult(
                    SetTaskParentStatus.AlreadySet,
                    existing));
            }

            var visited = new HashSet<Guid>();
            var ancestorId = parentTaskId;
            while (visited.Add(ancestorId) && _taskParents.TryGetValue(ancestorId, out var ancestor))
            {
                ancestorId = ancestor.ParentTaskId;
                if (ancestorId == taskId)
                {
                    return Task.FromResult(new SetTaskParentResult(SetTaskParentStatus.Cycle, null));
                }
            }

            var now = DateTimeOffset.UtcNow;
            var relation = new TaskParentAssignment(taskId, parentTaskId, userId, now);
            _taskParents[taskId] = relation;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.parent_set", "task", taskId,
                userId, _users[userId].DisplayName,
                $"{task.Key} est maintenant une sous-tâche de {parent.Key}", now);
            return Task.FromResult(new SetTaskParentResult(SetTaskParentStatus.Updated, relation));
        }
    }

    public Task<bool> RemoveTaskParentAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_taskParents.Remove(taskId, out var relation))
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            var parentKey = _tasks.TryGetValue(relation.ParentTaskId, out var parent)
                ? parent.Key
                : relation.ParentTaskId.ToString();
            AddActivity(
                organizationId, "task.parent_removed", "task", taskId,
                userId, _users[userId].DisplayName,
                $"{task.Key} n’est plus une sous-tâche de {parentKey}", now);
            return Task.FromResult(true);
        }
    }

    public Task<TaskPageSlice?> GetTaskPageAsync(
        Guid organizationId,
        Guid projectId,
        TaskPageRequest request,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId)
            {
                return Task.FromResult<TaskPageSlice?>(null);
            }

            HashSet<Guid>? selectedLabelIds = null;
            if (request.LabelId is Guid selectedLabelId)
            {
                selectedLabelIds = [selectedLabelId];
                var pendingLabels = new Queue<Guid>();
                pendingLabels.Enqueue(selectedLabelId);
                while (pendingLabels.TryDequeue(out var parentLabelId))
                {
                    foreach (var child in _projectLabels.Values.Where(label =>
                                 label.OrganizationId == organizationId
                                 && label.ProjectId == projectId
                                 && label.ParentLabelId == parentLabelId))
                    {
                        if (selectedLabelIds.Add(child.Id)) pendingLabels.Enqueue(child.Id);
                    }
                }
            }

            var matching = _tasks.Values
                .Where(task => task.OrganizationId == organizationId && task.ProjectId == projectId)
                .Where(task => MatchesTaskPageRequest(task, request))
                .Where(task =>
                {
                    var labels = _taskLabelAssignments.Keys
                        .Where(key => key.TaskId == task.Id)
                        .Select(key => key.LabelId);
                    if (request.WithoutLabel)
                    {
                        return !labels.Any();
                    }

                    return selectedLabelIds is null || labels.Any(selectedLabelIds.Contains);
                })
                .ToArray();
            var totalCount = matching.Length;
            var ordered = OrderTaskPage(matching, request.Sort)
                .Where(task => request.Cursor is null || IsAfterTaskCursor(task, request))
                .Take(request.Limit + 1)
                .ToArray();
            var hasMore = ordered.Length > request.Limit;
            IReadOnlyList<WorkItem> items = hasMore ? ordered[..request.Limit] : ordered;
            return Task.FromResult<TaskPageSlice?>(new(items, totalCount, hasMore));
        }
    }

    public Task<IReadOnlyList<TaskOption>?> ListTaskOptionsAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_projects.TryGetValue(projectId, out var project)
                || project.OrganizationId != organizationId)
            {
                return Task.FromResult<IReadOnlyList<TaskOption>?>(null);
            }

            IReadOnlyList<TaskOption> result = _tasks.Values
                .Where(task => task.OrganizationId == organizationId && task.ProjectId == projectId)
                .OrderBy(task => task.Number)
                .Select(task => new TaskOption(
                    task.Id,
                    task.ProjectId,
                    task.Key,
                    task.Title,
                    task.Status))
                .ToArray();
            return Task.FromResult<IReadOnlyList<TaskOption>?>(result);
        }
    }

    public Task<IReadOnlyList<WorkItem>?> ListTasksAsync(
        Guid organizationId,
        Guid projectId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_projects.TryGetValue(projectId, out var project) || project.OrganizationId != organizationId)
            {
                return Task.FromResult<IReadOnlyList<WorkItem>?>(null);
            }

            IReadOnlyList<WorkItem> result = _tasks.Values
                .Where(task => task.OrganizationId == organizationId && task.ProjectId == projectId)
                .OrderByDescending(task => task.UpdatedAt)
                .ToArray();
            return Task.FromResult<IReadOnlyList<WorkItem>?>(result);
        }
    }

    public Task<WorkItem?> CreateTaskAsync(
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
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId || membership.Role == "viewer" ||
                !_projects.TryGetValue(projectId, out var project) || project.OrganizationId != organizationId)
            {
                return Task.FromResult<WorkItem?>(null);
            }

            if (assigneeId is Guid assignedUserId
                && (!_memberships.TryGetValue(assignedUserId, out var assignedMembership)
                    || assignedMembership.OrganizationId != organizationId))
            {
                return Task.FromResult<WorkItem?>(null);
            }

            var number = project.NextTaskNumber;
            _projects[projectId] = project with { NextTaskNumber = number + 1 };
            var now = DateTimeOffset.UtcNow;
            var task = new WorkItem(
                Guid.CreateVersion7(),
                organizationId,
                projectId,
                number,
                $"{project.Key}-{number}",
                title,
                description,
                "todo",
                priority,
                dueAt,
                assigneeId,
                assigneeId is Guid assignedId ? _users[assignedId].DisplayName : null,
                1,
                userId,
                now,
                now);
            _tasks.Add(task.Id, task);
            AddActivity(
                organizationId, "task.created", "task", task.Id,
                userId, _users[userId].DisplayName, $"Tâche {task.Key} créée", now);
            return Task.FromResult<WorkItem?>(task);
        }
    }

    public Task<TaskDetails?> GetTaskAsync(Guid organizationId, Guid taskId, CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult<TaskDetails?>(null);
            }

            IReadOnlyList<Comment> comments = _comments.Values
                .Where(comment => comment.OrganizationId == organizationId && comment.TaskId == taskId)
                .OrderBy(comment => comment.CreatedAt)
                .ToArray();
            IReadOnlyList<TaskChecklistItem> checklist = _checklistItems.Values
                .Where(item => item.OrganizationId == organizationId && item.TaskId == taskId)
                .OrderBy(item => item.Position)
                .ThenBy(item => item.Id)
                .ToArray();
            return Task.FromResult<TaskDetails?>(new(task, comments, checklist));
        }
    }


    public Task<TaskChecklistItem?> CreateChecklistItemAsync(
        Guid organizationId,
        Guid taskId,
        Guid userId,
        string title,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || _checklistItems.Values.Count(item =>
                    item.OrganizationId == organizationId && item.TaskId == taskId) >= 200)
            {
                return Task.FromResult<TaskChecklistItem?>(null);
            }

            var position = _checklistItems.Values
                .Where(item => item.OrganizationId == organizationId && item.TaskId == taskId)
                .Select(item => item.Position)
                .DefaultIfEmpty(-1)
                .Max() + 1;
            var now = DateTimeOffset.UtcNow;
            var item = new TaskChecklistItem(
                Guid.CreateVersion7(),
                organizationId,
                taskId,
                title,
                false,
                position,
                1,
                userId,
                now,
                now);
            _checklistItems.Add(item.Id, item);
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.checklist_item_created", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Élément ajouté à la checklist de {task.Key}", now);
            return Task.FromResult<TaskChecklistItem?>(item);
        }
    }

    public Task<UpdateChecklistItemResult> UpdateChecklistItemAsync(
        Guid organizationId,
        Guid taskId,
        Guid itemId,
        Guid userId,
        string title,
        bool isCompleted,
        long expectedRevision,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_checklistItems.TryGetValue(itemId, out var item)
                || item.OrganizationId != organizationId
                || item.TaskId != taskId)
            {
                return Task.FromResult(new UpdateChecklistItemResult(
                    UpdateChecklistItemStatus.NotFound, null));
            }

            if (item.Revision != expectedRevision)
            {
                return Task.FromResult(new UpdateChecklistItemResult(
                    UpdateChecklistItemStatus.RevisionConflict, item));
            }

            var now = DateTimeOffset.UtcNow;
            var updated = item with
            {
                Title = title,
                IsCompleted = isCompleted,
                Revision = item.Revision + 1,
                UpdatedAt = now
            };
            _checklistItems[itemId] = updated;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.checklist_item_updated", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Checklist de {task.Key} mise à jour", now);
            return Task.FromResult(new UpdateChecklistItemResult(
                UpdateChecklistItemStatus.Updated, updated));
        }
    }

    public Task<UpdateChecklistItemStatus> DeleteChecklistItemAsync(
        Guid organizationId,
        Guid taskId,
        Guid itemId,
        Guid userId,
        long expectedRevision,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_checklistItems.TryGetValue(itemId, out var item)
                || item.OrganizationId != organizationId
                || item.TaskId != taskId)
            {
                return Task.FromResult(UpdateChecklistItemStatus.NotFound);
            }

            if (item.Revision != expectedRevision)
            {
                return Task.FromResult(UpdateChecklistItemStatus.RevisionConflict);
            }

            _checklistItems.Remove(itemId);
            var now = DateTimeOffset.UtcNow;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.checklist_item_deleted", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Élément supprimé de la checklist de {task.Key}", now);
            return Task.FromResult(UpdateChecklistItemStatus.Updated);
        }
    }

    public Task<TaskDependencyOverview?> GetTaskDependenciesAsync(
        Guid organizationId,
        Guid taskId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult<TaskDependencyOverview?>(null);
            }

            IReadOnlyList<TaskRelation> dependsOn = _taskDependencies.Values
                .Where(edge => edge.OrganizationId == organizationId && edge.TaskId == taskId)
                .Select(edge => ToTaskRelation(_tasks[edge.DependsOnTaskId], edge.CreatedAt))
                .OrderBy(relation => relation.Key, StringComparer.Ordinal)
                .ToArray();
            IReadOnlyList<TaskRelation> blocking = _taskDependencies.Values
                .Where(edge => edge.OrganizationId == organizationId && edge.DependsOnTaskId == taskId)
                .Select(edge => ToTaskRelation(_tasks[edge.TaskId], edge.CreatedAt))
                .OrderBy(relation => relation.Key, StringComparer.Ordinal)
                .ToArray();
            return Task.FromResult<TaskDependencyOverview?>(new(dependsOn, blocking));
        }
    }

    public Task<AddTaskDependencyResult> AddTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_tasks.TryGetValue(dependsOnTaskId, out var dependency)
                || dependency.OrganizationId != organizationId)
            {
                return Task.FromResult(new AddTaskDependencyResult(AddTaskDependencyStatus.NotFound, null));
            }

            if (taskId == dependsOnTaskId)
            {
                return Task.FromResult(new AddTaskDependencyResult(AddTaskDependencyStatus.SelfDependency, null));
            }

            if (_taskDependencies.TryGetValue((taskId, dependsOnTaskId), out var existing))
            {
                return Task.FromResult(new AddTaskDependencyResult(
                    AddTaskDependencyStatus.AlreadyExists,
                    ToTaskRelation(dependency, existing.CreatedAt)));
            }

            if (DependencyPathExists(organizationId, dependsOnTaskId, taskId))
            {
                return Task.FromResult(new AddTaskDependencyResult(AddTaskDependencyStatus.Cycle, null));
            }

            var now = DateTimeOffset.UtcNow;
            _taskDependencies.Add(
                (taskId, dependsOnTaskId),
                new TaskDependencyEntry(organizationId, taskId, dependsOnTaskId, userId, now));
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.dependency_added", "task", taskId,
                userId, _users[userId].DisplayName,
                $"{task.Key} dépend maintenant de {dependency.Key}", now);
            return Task.FromResult(new AddTaskDependencyResult(
                AddTaskDependencyStatus.Created,
                ToTaskRelation(dependency, now)));
        }
    }

    public Task<bool> RemoveTaskDependencyAsync(
        Guid organizationId,
        Guid taskId,
        Guid dependsOnTaskId,
        Guid userId,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_memberships.TryGetValue(userId, out var membership)
                || membership.OrganizationId != organizationId
                || membership.Role == "viewer"
                || !_tasks.TryGetValue(taskId, out var task)
                || task.OrganizationId != organizationId
                || !_tasks.TryGetValue(dependsOnTaskId, out var dependency)
                || dependency.OrganizationId != organizationId
                || !_taskDependencies.Remove((taskId, dependsOnTaskId)))
            {
                return Task.FromResult(false);
            }

            var now = DateTimeOffset.UtcNow;
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = now };
            AddActivity(
                organizationId, "task.dependency_removed", "task", taskId,
                userId, _users[userId].DisplayName,
                $"Dépendance entre {task.Key} et {dependency.Key} supprimée", now);
            return Task.FromResult(true);
        }
    }

    public Task<UpdateTaskResult> UpdateTaskAsync(
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
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId)
            {
                return Task.FromResult(new UpdateTaskResult(UpdateTaskStatus.NotFound, null));
            }

            if (!_memberships.TryGetValue(userId, out var membership) ||
                membership.OrganizationId != organizationId || membership.Role == "viewer")
            {
                return Task.FromResult(new UpdateTaskResult(UpdateTaskStatus.NotFound, null));
            }


            if (assigneeId is Guid assignedUserId
                && (!_memberships.TryGetValue(assignedUserId, out var assignedMembership)
                    || assignedMembership.OrganizationId != organizationId))
            {
                return Task.FromResult(new UpdateTaskResult(UpdateTaskStatus.NotFound, null));
            }

            if (task.Revision != expectedRevision)
            {
                return Task.FromResult(new UpdateTaskResult(UpdateTaskStatus.RevisionConflict, task));
            }

            var updated = task with
            {
                Title = title,
                Description = description,
                Status = status,
                Priority = priority,
                DueAt = dueAt,
                AssigneeId = assigneeId,
                AssigneeName = assigneeId is Guid assignedId ? _users[assignedId].DisplayName : null,
                Revision = task.Revision + 1,
                UpdatedAt = DateTimeOffset.UtcNow
            };
            _tasks[taskId] = updated;
            AddActivity(
                organizationId, "task.updated", "task", taskId,
                userId, _users[userId].DisplayName, $"Tâche {updated.Key} mise à jour", updated.UpdatedAt);
            return Task.FromResult(new UpdateTaskResult(UpdateTaskStatus.Updated, updated));
        }
    }

    public Task<Comment?> AddCommentAsync(
        Guid organizationId,
        Guid taskId,
        Guid authorId,
        string body,
        CancellationToken cancellationToken)
    {
        lock (_gate)
        {
            if (!_tasks.TryGetValue(taskId, out var task) || task.OrganizationId != organizationId ||
                !_users.TryGetValue(authorId, out var author) ||
                !_memberships.TryGetValue(authorId, out var membership) ||
                membership.OrganizationId != organizationId || membership.Role == "viewer")
            {
                return Task.FromResult<Comment?>(null);
            }

            var comment = new Comment(
                Guid.CreateVersion7(),
                organizationId,
                taskId,
                authorId,
                author.DisplayName,
                body,
                DateTimeOffset.UtcNow);
            _comments.Add(comment.Id, comment);
            _tasks[taskId] = task with { Revision = task.Revision + 1, UpdatedAt = comment.CreatedAt };
            AddActivity(
                organizationId, "comment.created", "task", taskId,
                authorId, author.DisplayName, $"Commentaire ajouté à {task.Key}", comment.CreatedAt);
            return Task.FromResult<Comment?>(comment);
        }
    }

    private static bool MatchesTaskPageRequest(WorkItem task, TaskPageRequest request)
    {
        if (request.Status is not null && task.Status != request.Status)
        {
            return false;
        }

        if (request.Priority is not null && task.Priority != request.Priority)
        {
            return false;
        }

        if (request.Unassigned && task.AssigneeId is not null)
        {
            return false;
        }

        if (request.AssigneeId is Guid assigneeId && task.AssigneeId != assigneeId)
        {
            return false;
        }

        if (!MatchesTaskDueFilter(task, request))
        {
            return false;
        }

        if (request.Query.Length == 0)
        {
            return true;
        }

        return task.Key.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || task.Title.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || task.Description.Contains(request.Query, StringComparison.OrdinalIgnoreCase)
            || (task.AssigneeName?.Contains(request.Query, StringComparison.OrdinalIgnoreCase) ?? false);
    }

    private static bool MatchesTaskDueFilter(WorkItem task, TaskPageRequest request) =>
        request.DueFilter switch
        {
            "all" => true,
            "none" => task.DueAt is null,
            "overdue" => task.DueAt is DateTimeOffset dueAt
                && dueAt < request.Now
                && task.Status is not ("done" or "cancelled"),
            "today" or "week" => task.DueAt is DateTimeOffset dueAt
                && request.DueStart is DateTimeOffset dueStart
                && request.DueEnd is DateTimeOffset dueEnd
                && dueAt >= dueStart
                && dueAt < dueEnd,
            _ => false
        };

    private static IOrderedEnumerable<WorkItem> OrderTaskPage(
        IEnumerable<WorkItem> tasks,
        string sort) => sort switch
        {
            "created" => tasks.OrderByDescending(task => task.CreatedAt).ThenBy(task => task.Id),
            "due" => tasks.OrderBy(task => task.DueAt is null).ThenBy(task => task.DueAt).ThenBy(task => task.Id),
            "key" => tasks.OrderBy(task => task.Number).ThenBy(task => task.Id),
            "title" => tasks.OrderBy(task => task.Title, StringComparer.Ordinal).ThenBy(task => task.Id),
            _ => tasks.OrderByDescending(task => task.UpdatedAt).ThenBy(task => task.Id)
        };

    private static bool IsAfterTaskCursor(WorkItem task, TaskPageRequest request)
    {
        var cursor = request.Cursor!;
        var idIsAfter = task.Id.CompareTo(cursor.TaskId) > 0;
        var timestamp = cursor.Timestamp.GetValueOrDefault();
        var number = cursor.Number.GetValueOrDefault();
        return request.Sort switch
        {
            "updated" => task.UpdatedAt < timestamp
                || (task.UpdatedAt == timestamp && idIsAfter),
            "created" => task.CreatedAt < timestamp
                || (task.CreatedAt == timestamp && idIsAfter),
            "due" when cursor.IsNull => task.DueAt is null && idIsAfter,
            "due" => task.DueAt is null
                || task.DueAt > timestamp
                || (task.DueAt == timestamp && idIsAfter),
            "key" => task.Number > number
                || (task.Number == number && idIsAfter),
            "title" => string.CompareOrdinal(task.Title, cursor.Text) > 0
                || (task.Title == cursor.Text && idIsAfter),
            _ => false
        };
    }

    private void AddActivity(
        Guid organizationId,
        string eventType,
        string aggregateType,
        Guid aggregateId,
        Guid? actorId,
        string actorName,
        string summary,
        DateTimeOffset createdAt) =>
        _activities.Add(new ActivityEntry(
            Guid.CreateVersion7(), organizationId, eventType, aggregateType,
            aggregateId, actorId, actorName, summary, createdAt));

    private bool DependencyPathExists(Guid organizationId, Guid startTaskId, Guid targetTaskId)
    {
        var visited = new HashSet<Guid>();
        var pending = new Stack<Guid>();
        pending.Push(startTaskId);
        while (pending.TryPop(out var current))
        {
            if (current == targetTaskId)
            {
                return true;
            }

            if (!visited.Add(current))
            {
                continue;
            }

            foreach (var edge in _taskDependencies.Values.Where(
                         edge => edge.OrganizationId == organizationId && edge.TaskId == current))
            {
                pending.Push(edge.DependsOnTaskId);
            }
        }

        return false;
    }

    private static TaskRelation ToTaskRelation(WorkItem task, DateTimeOffset linkedAt) =>
        new(task.Id, task.ProjectId, task.Key, task.Title, task.Status, linkedAt);

    private sealed record SessionEntry(AuthenticatedUser User);

    private sealed record NativeAuthorizationEntry(
        Guid Id,
        Guid UserId,
        Guid OrganizationId,
        string ClientId,
        string RedirectUri,
        string CodeChallenge,
        DateTimeOffset ExpiresAt,
        DateTimeOffset CreatedAt);

    private sealed record AccessTokenEntry(
        Guid Id,
        Guid UserId,
        Guid OrganizationId,
        string ClientId,
        DateTimeOffset ExpiresAt,
        DateTimeOffset CreatedAt);

    private sealed record ApiTokenEntry(ApiToken Token, Guid OrganizationId, Guid UserId);

    private sealed record InvitationEntry(
        Guid Id,
        Guid OrganizationId,
        string Email,
        string Role,
        Guid CreatedBy,
        DateTimeOffset ExpiresAt,
        DateTimeOffset CreatedAt,
        DateTimeOffset? AcceptedAt,
        DateTimeOffset? RevokedAt);

    private sealed record TaskDependencyEntry(
        Guid OrganizationId,
        Guid TaskId,
        Guid DependsOnTaskId,
        Guid CreatedBy,
        DateTimeOffset CreatedAt);
}
