CREATE TABLE project_plugins (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    plugin_id text NOT NULL,
    enabled_by uuid NOT NULL,
    enabled_at timestamptz NOT NULL,
    PRIMARY KEY (project_id, plugin_id),
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (enabled_by) REFERENCES users(id),
    CHECK (plugin_id ~ '^[a-z0-9]+([.-][a-z0-9]+)+$'),
    CHECK (length(plugin_id) <= 128)
);

CREATE INDEX project_plugins_organization_idx
    ON project_plugins(organization_id, project_id);

CREATE TABLE task_plugin_data (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    plugin_id text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    revision bigint NOT NULL DEFAULT 1,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, plugin_id),
    FOREIGN KEY (organization_id, project_id, task_id)
        REFERENCES tasks(organization_id, project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, plugin_id)
        REFERENCES project_plugins(project_id, plugin_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    CHECK (jsonb_typeof(data) = 'object'),
    CHECK (octet_length(data::text) <= 65536),
    CHECK (revision >= 1)
);

CREATE INDEX task_plugin_data_project_idx
    ON task_plugin_data(organization_id, project_id, plugin_id, task_id);
