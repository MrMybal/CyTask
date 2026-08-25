ALTER TABLE projects
    ADD CONSTRAINT projects_organization_id_id_unique UNIQUE (organization_id, id);

CREATE TABLE project_labels (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid NOT NULL,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    color text NOT NULL CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    UNIQUE (organization_id, id),
    FOREIGN KEY (organization_id, project_id)
        REFERENCES projects(organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX project_labels_name_unique_idx
    ON project_labels(organization_id, project_id, lower(name));

CREATE INDEX project_labels_project_idx
    ON project_labels(organization_id, project_id, lower(name), id);

CREATE TABLE task_labels (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL,
    label_id uuid NOT NULL,
    assigned_by uuid NOT NULL REFERENCES users(id),
    assigned_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, label_id),
    FOREIGN KEY (organization_id, task_id)
        REFERENCES tasks(organization_id, id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id, label_id)
        REFERENCES project_labels(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX task_labels_label_idx
    ON task_labels(organization_id, label_id, task_id);
