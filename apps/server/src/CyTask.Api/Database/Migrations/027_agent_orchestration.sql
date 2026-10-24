CREATE TABLE agent_members (
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    agent_key text NOT NULL,
    description text NOT NULL DEFAULT '',
    capabilities text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'active',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    last_seen_at timestamptz NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    PRIMARY KEY (organization_id, user_id),
    UNIQUE (organization_id, agent_key),
    FOREIGN KEY (organization_id, user_id)
        REFERENCES organization_members(organization_id, user_id) ON DELETE CASCADE,
    CHECK (agent_key ~ '^[a-z][a-z0-9-]{1,39}$'),
    CHECK (char_length(description) <= 2000),
    CHECK (cardinality(capabilities) <= 32),
    CHECK (status IN ('active', 'paused', 'disabled'))
);

CREATE INDEX agent_members_status_idx
    ON agent_members(organization_id, status, agent_key);

CREATE TABLE agent_notifications (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL,
    agent_user_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    notification_type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    task_id uuid NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_at timestamptz NOT NULL,
    acknowledged_at timestamptz NULL,
    FOREIGN KEY (organization_id, agent_user_id)
        REFERENCES agent_members(organization_id, user_id) ON DELETE CASCADE,
    FOREIGN KEY (task_id, organization_id)
        REFERENCES tasks(id, organization_id) ON DELETE CASCADE,
    CHECK (notification_type ~ '^[a-z][a-z0-9_.-]{0,39}$'),
    CHECK (char_length(title) BETWEEN 1 AND 160),
    CHECK (char_length(body) <= 10000)
);

CREATE INDEX agent_notifications_inbox_idx
    ON agent_notifications(organization_id, agent_user_id, created_at)
    WHERE acknowledged_at IS NULL;
