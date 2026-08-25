ALTER TABLE project_labels
    ADD COLUMN parent_label_id uuid NULL;

ALTER TABLE project_labels
    ADD CONSTRAINT project_labels_parent_fk
        FOREIGN KEY (parent_label_id) REFERENCES project_labels(id) ON DELETE SET NULL,
    ADD CONSTRAINT project_labels_parent_not_self
        CHECK (parent_label_id IS NULL OR parent_label_id <> id);

CREATE INDEX project_labels_parent_idx
    ON project_labels(organization_id, project_id, parent_label_id, lower(name), id);
