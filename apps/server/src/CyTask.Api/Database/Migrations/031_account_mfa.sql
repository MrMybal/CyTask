CREATE TABLE account_mfa (
    user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now()
);
-- Authentication material is server-owned and deliberately excluded from workspace
-- exports, local snapshots, project synchronization and organization member views.
