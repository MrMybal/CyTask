CREATE TABLE native_authorization_codes (
    id uuid PRIMARY KEY,
    code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id text NOT NULL CHECK (client_id = 'cytask-unreal'),
    redirect_uri text NOT NULL CHECK (char_length(redirect_uri) BETWEEN 1 AND 512),
    code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX native_authorization_codes_expires_idx
    ON native_authorization_codes(expires_at);

CREATE TABLE native_access_tokens (
    id uuid PRIMARY KEY,
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    client_id text NOT NULL CHECK (client_id = 'cytask-unreal'),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX native_access_tokens_user_idx
    ON native_access_tokens(user_id, organization_id);
CREATE INDEX native_access_tokens_expires_idx
    ON native_access_tokens(expires_at);
