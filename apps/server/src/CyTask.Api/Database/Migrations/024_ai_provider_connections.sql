CREATE TABLE ai_provider_connections (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    provider text NOT NULL,
    model text NOT NULL,
    base_url text,
    protected_secret text,
    secret_hint text,
    revision bigint NOT NULL DEFAULT 1,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (updated_by) REFERENCES users(id),
    CHECK (length(name) BETWEEN 1 AND 120),
    CHECK (provider IN ('openai', 'anthropic', 'openai-compatible', 'ollama', 'lm-studio', 'codex', 'claude-code', 'opencode')),
    CHECK (length(model) <= 200),
    CHECK (base_url IS NULL OR length(base_url) <= 2048),
    CHECK (protected_secret IS NULL OR length(protected_secret) <= 16384),
    CHECK (secret_hint IS NULL OR length(secret_hint) <= 16),
    CHECK (revision >= 1)
);

CREATE INDEX ai_provider_connections_project_idx
    ON ai_provider_connections(organization_id, project_id, updated_at DESC);