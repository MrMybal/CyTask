CREATE TABLE audit_events (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    event_type text NOT NULL CHECK (char_length(event_type) BETWEEN 1 AND 80),
    aggregate_type text NOT NULL CHECK (char_length(aggregate_type) BETWEEN 1 AND 40),
    aggregate_id uuid NOT NULL,
    actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_name text NOT NULL CHECK (char_length(actor_name) BETWEEN 1 AND 80),
    summary text NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 500),
    created_at timestamptz NOT NULL
);

CREATE INDEX audit_events_organization_created_idx
    ON audit_events(organization_id, created_at DESC, id DESC);
