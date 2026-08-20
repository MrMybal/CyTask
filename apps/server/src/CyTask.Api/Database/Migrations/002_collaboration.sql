CREATE TABLE invitations (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    normalized_email text NOT NULL CHECK (normalized_email = lower(normalized_email)),
    role text NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    created_by uuid NOT NULL REFERENCES users(id),
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz NULL,
    revoked_at timestamptz NULL,
    created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX invitations_active_email_idx
    ON invitations(organization_id, normalized_email)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE INDEX invitations_expiry_idx
    ON invitations(expires_at)
    WHERE accepted_at IS NULL AND revoked_at IS NULL;
