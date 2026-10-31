CREATE TABLE data_encryption_state (
    id integer PRIMARY KEY CHECK (id = 1),
    proof text NOT NULL,
    enabled_at timestamptz NOT NULL DEFAULT now()
);

-- Content validation remains on plaintext at the API boundary. Preserve existing
-- checks for ordinary installations, allowing the larger authenticated envelopes.
DO $$
DECLARE item record;
BEGIN
    FOR item IN
        SELECT c.conname, t.relname, a.attname, a.atttypid,
               pg_get_expr(c.conbin, c.conrelid) AS expression
        FROM pg_constraint c
        JOIN pg_class t ON t.oid = c.conrelid
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
        WHERE c.contype = 'c' AND (t.relname, a.attname) IN (
            ('tasks','title'),('tasks','description'),('comments','body'),
            ('audit_events','actor_name'),('audit_events','summary'),('attachments','file_name'),
            ('external_references','label'),('external_references','web_url'),
            ('task_checklist_items','title'),('project_resources','name'),('project_resources','body'),
            ('chat_channels','topic'),('chat_messages','body'),('task_plugin_data','data'),
            ('task_plugin_data_history','data'),('cyannota_documents','document'),
            ('agent_members','description'),('agent_notifications','title'),('agent_notifications','body')
        ) AND (pg_get_expr(c.conbin,c.conrelid) LIKE '%length(%')
    LOOP
        EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', item.relname, item.conname);
        IF item.atttypid = 'jsonb'::regtype THEN
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR (%I ? ''_cytask_encrypted''))',
                item.relname, item.conname, item.expression, item.attname);
        ELSE
            EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK ((%s) OR (%I LIKE ''cytask:enc:v1:%%''))',
                item.relname, item.conname, item.expression, item.attname);
        END IF;
    END LOOP;
END $$;

-- Encrypted installations reject accidental plaintext writes from older nodes,
-- integrations or future store code. Relational/routing columns are unaffected.
CREATE FUNCTION cytask_require_encrypted_content() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field_name text; value jsonb; text_value text;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM data_encryption_state WHERE id=1) THEN RETURN NEW; END IF;
    FOREACH field_name IN ARRAY TG_ARGV LOOP
        value := to_jsonb(NEW) -> field_name;
        IF value IS NULL OR value = 'null'::jsonb OR value = '""'::jsonb OR value = '{}'::jsonb THEN CONTINUE; END IF;
        IF jsonb_typeof(value) = 'string' THEN
            text_value := value #>> '{}';
            IF text_value LIKE 'cytask:enc:v1:%' THEN CONTINUE; END IF;
        ELSIF jsonb_typeof(value) = 'object' AND value ? '_cytask_encrypted'
            AND value - '_cytask_encrypted' = '{}'::jsonb AND (value->>'_cytask_encrypted') LIKE 'cytask:enc:v1:%' THEN
            CONTINUE;
        END IF;
        RAISE EXCEPTION 'Encrypted content required for %.%', TG_TABLE_NAME, field_name USING ERRCODE = '23514';
    END LOOP;
    RETURN NEW;
END $$;

DO $$
DECLARE item record;
BEGIN
    FOR item IN SELECT table_name, string_agg(quote_literal(column_name), ',') AS arguments FROM (VALUES
        ('tasks','title'),('tasks','description'),('comments','body'),('audit_events','actor_name'),('audit_events','summary'),
        ('attachments','file_name'),('external_references','label'),('external_references','web_url'),('task_checklist_items','title'),
        ('project_resources','name'),('project_resources','body'),('chat_channels','topic'),('chat_messages','body'),
        ('task_plugin_data','data'),('task_plugin_data_history','data'),('cyannota_documents','document'),
        ('project_spaces','body'),('content_plugin_data','body'),('outbox_events','payload'),
        ('agent_members','description'),('agent_notifications','title'),('agent_notifications','body')
    ) AS fields(table_name,column_name) GROUP BY table_name LOOP
        EXECUTE format('CREATE TRIGGER content_encryption_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION cytask_require_encrypted_content(%s)', item.table_name,item.arguments);
    END LOOP;
END $$;
