ALTER TABLE tasks
    ADD CONSTRAINT tasks_organization_project_id_unique
        UNIQUE (organization_id, project_id, id);

CREATE TABLE task_hierarchy (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    parent_task_id uuid NOT NULL,
    linked_by uuid NOT NULL REFERENCES users(id),
    linked_at timestamptz NOT NULL,
    PRIMARY KEY (organization_id, task_id),
    CHECK (task_id <> parent_task_id),
    FOREIGN KEY (organization_id, project_id, task_id)
        REFERENCES tasks(organization_id, project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, project_id, parent_task_id)
        REFERENCES tasks(organization_id, project_id, id) ON DELETE CASCADE
);

CREATE INDEX task_hierarchy_project_idx
    ON task_hierarchy(organization_id, project_id, task_id);

CREATE INDEX task_hierarchy_parent_idx
    ON task_hierarchy(organization_id, project_id, parent_task_id, task_id);

COMMENT ON TABLE task_hierarchy IS
    'Hiérarchie acyclique des tâches, validée sous verrou transactionnel par organisation.';
