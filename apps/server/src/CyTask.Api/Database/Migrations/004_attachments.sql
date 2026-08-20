CREATE TABLE attachments (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 240),
    declared_content_type text NOT NULL CHECK (char_length(declared_content_type) BETWEEN 1 AND 120),
    detected_content_type text NULL CHECK (char_length(detected_content_type) BETWEEN 1 AND 120),
    size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 1 AND 53687091200),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    status text NOT NULL CHECK (status IN ('uploading', 'quarantined', 'available', 'rejected')),
    optimized_locally boolean NOT NULL DEFAULT false,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL
);

CREATE INDEX attachments_task_created_idx
    ON attachments(task_id, created_at, id);
CREATE INDEX attachments_organization_id_idx
    ON attachments(organization_id);

CREATE TABLE attachment_uploads (
    id uuid PRIMARY KEY,
    organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    attachment_id uuid NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE CASCADE,
    chunk_size_bytes integer NOT NULL CHECK (chunk_size_bytes BETWEEN 65536 AND 10485760),
    status text NOT NULL CHECK (status IN ('active', 'completed', 'rejected', 'expired')),
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL
);

CREATE INDEX attachment_uploads_expiry_idx
    ON attachment_uploads(expires_at)
    WHERE status = 'active';

CREATE TABLE attachment_upload_chunks (
    upload_id uuid NOT NULL REFERENCES attachment_uploads(id) ON DELETE CASCADE,
    chunk_index integer NOT NULL CHECK (chunk_index >= 0),
    size_bytes bigint NOT NULL CHECK (size_bytes > 0),
    sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL,
    PRIMARY KEY (upload_id, chunk_index)
);
