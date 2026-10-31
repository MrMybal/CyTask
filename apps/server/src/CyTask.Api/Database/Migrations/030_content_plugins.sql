CREATE TABLE content_plugin_data (
    organization_id uuid NOT NULL REFERENCES organizations(id),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    content_kind text NOT NULL CHECK (content_kind IN ('message','resource','task')),
    content_id uuid NOT NULL,
    plugin_id text NOT NULL,
    action_id text NOT NULL,
    body jsonb NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0),
    PRIMARY KEY (project_id,content_kind,content_id,plugin_id,action_id)
);
CREATE INDEX content_plugin_data_organization ON content_plugin_data(organization_id);
ALTER TABLE content_plugin_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_plugin_data FORCE ROW LEVEL SECURITY;
CREATE POLICY content_plugin_tenant ON content_plugin_data USING (
    organization_id = nullif(current_setting('cytask.organization_id', true), '')::uuid
) WITH CHECK (
    organization_id = nullif(current_setting('cytask.organization_id', true), '')::uuid
);
