ALTER TABLE tasks
    ADD CONSTRAINT tasks_organization_id_id_unique UNIQUE (organization_id, id);

CREATE TABLE task_dependencies (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL,
    depends_on_task_id uuid NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id),
    FOREIGN KEY (organization_id, task_id)
        REFERENCES tasks(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, depends_on_task_id)
        REFERENCES tasks(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX task_dependencies_reverse_idx
    ON task_dependencies(organization_id, depends_on_task_id, task_id);
