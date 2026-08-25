CREATE INDEX tasks_page_updated_idx
    ON tasks(organization_id, project_id, updated_at DESC, id);

CREATE INDEX tasks_page_created_idx
    ON tasks(organization_id, project_id, created_at DESC, id);

CREATE INDEX tasks_page_due_idx
    ON tasks(organization_id, project_id, due_at ASC NULLS LAST, id);

CREATE INDEX tasks_page_title_idx
    ON tasks(organization_id, project_id, title COLLATE "C", id);

COMMENT ON INDEX tasks_page_updated_idx IS
    'Ordre stable de la pagination des tâches par activité.';
