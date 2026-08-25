CREATE TABLE project_resources (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    folder_label_id uuid NULL REFERENCES project_labels(id) ON DELETE SET NULL,
    resource_type text NOT NULL CHECK (resource_type IN ('document', 'canvas', 'file')),
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 240),
    body text NOT NULL DEFAULT '' CHECK (octet_length(body) <= 2097152),
    declared_content_type text NULL,
    detected_content_type text NULL,
    size_bytes bigint NOT NULL DEFAULT 0 CHECK (size_bytes >= 0),
    sha256 text NULL CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('ready', 'uploading', 'available', 'rejected')),
    rejection_reason text NULL,
    revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL
);

CREATE INDEX project_resources_project_folder_idx
    ON project_resources(organization_id, project_id, folder_label_id, updated_at DESC, id);

CREATE TABLE project_resource_uploads (
    id uuid PRIMARY KEY,
    resource_id uuid NOT NULL UNIQUE REFERENCES project_resources(id) ON DELETE CASCADE,
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes BETWEEN 65536 AND 10485760),
    status text NOT NULL CHECK (status IN ('active', 'completed', 'rejected', 'expired')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE TABLE project_resource_upload_chunks (
    upload_id uuid NOT NULL REFERENCES project_resource_uploads(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (upload_id, chunk_index)
);

CREATE TABLE chat_channels (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
    slug text NOT NULL CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
    topic text NOT NULL DEFAULT '' CHECK (char_length(topic) <= 500),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    UNIQUE (project_id, slug)
);

CREATE INDEX chat_channels_project_idx ON chat_channels(organization_id, project_id, created_at, id);

CREATE TABLE chat_messages (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    channel_id uuid NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    author_id uuid NOT NULL REFERENCES users(id),
    body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
    created_at timestamptz NOT NULL,
    edited_at timestamptz NULL
);

CREATE INDEX chat_messages_channel_created_idx ON chat_messages(channel_id, created_at DESC, id DESC);

CREATE TABLE chat_message_resources (
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    resource_id uuid NOT NULL REFERENCES project_resources(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, resource_id)
);

CREATE TABLE chat_mentions (
    message_id uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
);
