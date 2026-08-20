ALTER TABLE attachments
    ADD COLUMN rejection_reason text NULL
        CHECK (rejection_reason IS NULL OR char_length(rejection_reason) BETWEEN 1 AND 200),
    ADD COLUMN width integer NULL CHECK (width IS NULL OR width BETWEEN 1 AND 1000000),
    ADD COLUMN height integer NULL CHECK (height IS NULL OR height BETWEEN 1 AND 1000000),
    ADD COLUMN reviewed_at timestamptz NULL,
    ADD COLUMN review_attempts integer NOT NULL DEFAULT 0 CHECK (review_attempts >= 0),
    ADD COLUMN review_leased_until timestamptz NULL;

CREATE INDEX attachments_pending_review_idx
    ON attachments(created_at, id)
    WHERE status = 'quarantined';
