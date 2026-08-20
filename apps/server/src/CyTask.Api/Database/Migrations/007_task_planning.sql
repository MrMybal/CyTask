ALTER TABLE tasks
    ADD COLUMN priority text NOT NULL DEFAULT 'normal'
        CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    ADD COLUMN due_at timestamptz NULL;

CREATE INDEX tasks_organization_due_idx
    ON tasks(organization_id, due_at)
    WHERE due_at IS NOT NULL AND status NOT IN ('done', 'cancelled');
