ALTER TABLE attachments
    ADD COLUMN duration_seconds double precision NULL
        CHECK (duration_seconds IS NULL OR (duration_seconds > 0 AND duration_seconds < 1000000));
