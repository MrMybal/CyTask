CREATE TABLE task_plugin_data_history (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    plugin_id text NOT NULL,
    data jsonb NOT NULL,
    revision bigint NOT NULL,
    updated_by uuid NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (task_id, plugin_id, revision),
    FOREIGN KEY (task_id, plugin_id)
        REFERENCES task_plugin_data(task_id, plugin_id) ON DELETE CASCADE,
    FOREIGN KEY (updated_by) REFERENCES users(id),
    CHECK (jsonb_typeof(data) = 'object'),
    CHECK (octet_length(data::text) <= 65536),
    CHECK (revision >= 1)
);

CREATE INDEX task_plugin_data_history_lookup_idx
    ON task_plugin_data_history(organization_id, task_id, plugin_id, revision DESC);

INSERT INTO task_plugin_data_history(
    organization_id, project_id, task_id, plugin_id, data,
    revision, updated_by, updated_at)
SELECT organization_id, project_id, task_id, plugin_id, data,
       revision, updated_by, updated_at
FROM task_plugin_data
ON CONFLICT DO NOTHING;