CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organizations (
    id uuid PRIMARY KEY,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    created_at timestamptz NOT NULL
);

CREATE TABLE users (
    id uuid PRIMARY KEY,
    normalized_email text NOT NULL UNIQUE CHECK (normalized_email = lower(normalized_email)),
    display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE organization_members (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE sessions (
    token_hash bytea PRIMARY KEY CHECK (octet_length(token_hash) = 32),
    csrf_hash bytea NOT NULL CHECK (octet_length(csrf_hash) = 32),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL,
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE
);

CREATE INDEX sessions_user_id_idx ON sessions(user_id);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE projects (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
    project_key text NOT NULL CHECK (project_key ~ '^[A-Z][A-Z0-9]{1,9}$'),
    next_task_number integer NOT NULL DEFAULT 1 CHECK (next_task_number > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    UNIQUE (organization_id, project_key)
);

CREATE INDEX projects_organization_id_idx ON projects(organization_id);

CREATE TABLE tasks (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_number integer NOT NULL CHECK (task_number > 0),
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 240),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
    status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (project_id, task_number)
);

CREATE INDEX tasks_project_updated_idx ON tasks(project_id, updated_at DESC);
CREATE INDEX tasks_organization_id_idx ON tasks(organization_id);

CREATE TABLE comments (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
    created_at timestamptz NOT NULL
);

CREATE INDEX comments_task_created_idx ON comments(task_id, created_at);
CREATE INDEX comments_organization_id_idx ON comments(organization_id);

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL,
    processed_at timestamptz NULL,
    attempts integer NOT NULL DEFAULT 0
);

CREATE INDEX outbox_pending_idx
    ON outbox_events(created_at)
    WHERE processed_at IS NULL;

