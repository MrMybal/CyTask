ALTER TABLE outbox_events
    ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN locked_until timestamptz NULL,
    ADD COLUMN last_error text NULL;

DROP INDEX outbox_pending_idx;

CREATE INDEX outbox_dispatch_idx
    ON outbox_events(available_at, created_at, id)
    WHERE processed_at IS NULL;

CREATE INDEX outbox_replay_idx
    ON outbox_events(organization_id, created_at, id);

ALTER TABLE outbox_events
    ADD CONSTRAINT outbox_attempts_non_negative
    CHECK (attempts >= 0);
