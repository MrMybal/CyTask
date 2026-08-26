ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;

CREATE TABLE project_statuses (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    status_key text NOT NULL,
    name text NOT NULL,
    color text NOT NULL,
    position integer NOT NULL,
    is_system boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL,
    created_at timestamptz NOT NULL,
    PRIMARY KEY (project_id, status_key),
    FOREIGN KEY (project_id, organization_id) REFERENCES projects(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id),
    CHECK (status_key ~ '^[a-z][a-z0-9_]{0,39}$'),
    CHECK (color ~ '^#[0-9A-F]{6}$')
);

CREATE TABLE task_assignees (
    organization_id uuid NOT NULL,
    task_id uuid NOT NULL,
    user_id uuid NOT NULL,
    assigned_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, user_id),
    FOREIGN KEY (task_id, organization_id) REFERENCES tasks(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX task_assignees_organization_user_idx
    ON task_assignees(organization_id, user_id, task_id);

INSERT INTO task_assignees(organization_id, task_id, user_id, assigned_at)
SELECT organization_id, id, assignee_id, updated_at
FROM tasks
WHERE assignee_id IS NOT NULL
ON CONFLICT DO NOTHING;
