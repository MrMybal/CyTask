ALTER TABLE external_references
    DROP CONSTRAINT IF EXISTS external_references_reference_type_check;

ALTER TABLE external_references
    ADD CONSTRAINT external_references_reference_type_check
    CHECK (reference_type IN ('commit', 'branch', 'tag', 'merge_request', 'task'));
