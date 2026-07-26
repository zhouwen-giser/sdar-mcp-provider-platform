ALTER TABLE provider_task
  ADD COLUMN handle_expires_at timestamptz,
  ADD COLUMN terminal_at timestamptz,
  ADD COLUMN expired_at timestamptz,
  ADD COLUMN purge_after timestamptz,
  ADD COLUMN last_confirmed_at timestamptz;

UPDATE provider_task
SET terminal_at = CASE
      WHEN internal_state LIKE 'TERMINAL_%' THEN updated_at
      ELSE NULL
    END,
    handle_expires_at = CASE
      WHEN internal_state LIKE 'TERMINAL_%'
        THEN updated_at + (COALESCE(ttl_ms, 86400000) * interval '1 millisecond')
      WHEN ttl_ms IS NOT NULL
        THEN GREATEST(updated_at, clock_timestamp()) + (ttl_ms * interval '1 millisecond')
      ELSE NULL
    END,
    last_confirmed_at = updated_at;

ALTER TABLE provider_task
  ADD CONSTRAINT provider_task_retention_order_check CHECK (
    ((terminal_at IS NOT NULL) = (internal_state LIKE 'TERMINAL_%')) AND
    (terminal_at IS NULL OR handle_expires_at IS NOT NULL) AND
    (expired_at IS NULL OR terminal_at IS NOT NULL) AND
    (purge_after IS NULL OR expired_at IS NOT NULL) AND
    (purge_after IS NULL OR purge_after >= expired_at)
  );

CREATE INDEX provider_task_handle_expiry_idx
  ON provider_task (handle_expires_at, task_id)
  WHERE expired_at IS NULL;

CREATE INDEX provider_task_purge_due_idx
  ON provider_task (purge_after, task_id)
  WHERE expired_at IS NOT NULL;
