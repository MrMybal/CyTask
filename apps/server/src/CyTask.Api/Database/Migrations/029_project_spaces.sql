CREATE TABLE project_spaces (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    body jsonb NOT NULL,
    revision bigint NOT NULL CHECK (revision > 0)
);
CREATE INDEX project_spaces_organization_idx ON project_spaces(organization_id);
ALTER TABLE project_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_spaces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_project_spaces ON project_spaces
    USING (organization_id = nullif(current_setting('cytask.organization_id', true),'')::uuid)
    WITH CHECK (organization_id = nullif(current_setting('cytask.organization_id', true),'')::uuid);
