ALTER TABLE tasks
    ADD COLUMN assignee_id uuid NULL;

ALTER TABLE tasks
    ADD CONSTRAINT tasks_assignee_membership_fk
    FOREIGN KEY (organization_id, assignee_id)
    REFERENCES organization_members(organization_id, user_id);

CREATE INDEX tasks_organization_assignee_idx
    ON tasks(organization_id, assignee_id)
    WHERE assignee_id IS NOT NULL;
