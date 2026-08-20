CREATE TABLE external_references (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9-]{0,39}$'),
    repository text NOT NULL CHECK (char_length(repository) BETWEEN 1 AND 240),
    reference_type text NOT NULL CHECK (reference_type IN ('commit', 'branch', 'tag', 'merge_request')),
    reference_value text NOT NULL CHECK (char_length(reference_value) BETWEEN 1 AND 240),
    label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 240),
    web_url text NULL CHECK (char_length(web_url) <= 2048),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    UNIQUE (task_id, provider, repository, reference_type, reference_value)
);

CREATE INDEX external_references_task_created_idx
    ON external_references(task_id, created_at, id);
CREATE INDEX external_references_organization_id_idx
    ON external_references(organization_id);
