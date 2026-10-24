ALTER TABLE project_statuses
    ADD COLUMN revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0);
