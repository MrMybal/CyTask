ALTER TABLE chat_channels
    ADD COLUMN channel_type text NOT NULL DEFAULT 'channel'
    CHECK (channel_type IN ('channel', 'group'));

ALTER TABLE chat_channels
    ADD CONSTRAINT chat_channels_organization_id_id_unique
    UNIQUE (organization_id, id);

CREATE FUNCTION cytask_current_org() RETURNS uuid
LANGUAGE sql STABLE
RETURN nullif(current_setting('cytask.organization_id', true), '')::uuid;

CREATE TABLE chat_channel_members (
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (channel_id, user_id),
    FOREIGN KEY (organization_id, channel_id)
        REFERENCES chat_channels(organization_id, id) ON DELETE CASCADE
);

CREATE INDEX chat_channel_members_user_idx
    ON chat_channel_members(organization_id, user_id, channel_id);

ALTER TABLE chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_channel_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_channel_members ON chat_channel_members
    USING (organization_id=cytask_current_org())
    WITH CHECK (organization_id=cytask_current_org());
