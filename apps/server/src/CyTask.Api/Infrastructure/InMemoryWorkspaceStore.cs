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
    private readonly Dictionary<Guid, Project> _projects = [];
    private readonly Dictionary<Guid, WorkItem> _tasks = [];
    private readonly Dictionary<Guid, Comment> _comments = [];
    private readonly Dictionary<string, InvitationEntry> _invitations = new(StringComparer.Ordinal);
    private readonly List<ActivityEntry> _activities = [];
    private readonly Dictionary<Guid, Attachment> _attachments = [];
    private readonly Dictionary<Guid, AttachmentUpload> _attachmentUploads = [];
    private readonly Dictionary<Guid, ExternalReference> _externalReferences = [];
    private readonly Dictionary<(Guid TaskId, Guid DependsOnTaskId), TaskDependencyEntry> _taskDependencies = [];

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
            var activity = _activities.Where(entry => entry.OrganizationId == organizationId).ToArray();
            var attachments = _attachments.Values
                .Where(attachment => attachment.OrganizationId == organizationId)
                .ToArray();
            return Task.FromResult<WorkspaceExport?>(new(
                1, DateTimeOffset.UtcNow, organization, members, projects, tasks, comments, activity, attachments));
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
            return Task.FromResult<TaskDetails?>(new(task, comments));
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
