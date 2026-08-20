CREATE TABLE api_tokens (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    token_hash bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    scopes text NOT NULL CHECK (scopes IN ('read', 'read write')),
    created_at timestamptz NOT NULL,
    expires_at timestamptz NULL,
    last_used_at timestamptz NULL,
    revoked_at timestamptz NULL
);

CREATE INDEX api_tokens_user_idx ON api_tokens(user_id, created_at);
