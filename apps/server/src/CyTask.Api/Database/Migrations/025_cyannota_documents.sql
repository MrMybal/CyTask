CREATE TABLE cyannota_documents (
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    attachment_id uuid NOT NULL PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
    media_kind text NOT NULL CHECK (media_kind IN ('image', 'video')),
    document jsonb NOT NULL,
    annotation_count integer NOT NULL DEFAULT 0 CHECK (annotation_count BETWEEN 0 AND 5000),
    revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
    updated_by uuid NOT NULL REFERENCES users(id),
    updated_at timestamptz NOT NULL,
    FOREIGN KEY (organization_id, project_id, task_id)
        REFERENCES tasks(organization_id, project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE CASCADE,
    CHECK (jsonb_typeof(document) = 'object'),
    CHECK (octet_length(document::text) <= 4194304)
);

CREATE INDEX cyannota_documents_task_idx
    ON cyannota_documents(organization_id, task_id, updated_at DESC);
