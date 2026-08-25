CREATE TABLE task_checklist_items (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 500),
    is_completed boolean NOT NULL DEFAULT false,
    position integer NOT NULL CHECK (position >= 0),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (task_id, position),
    FOREIGN KEY (organization_id, task_id)
        REFERENCES tasks(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX task_checklist_items_task_idx
    ON task_checklist_items(organization_id, task_id, position, id);
