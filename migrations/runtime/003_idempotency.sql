ALTER TABLE idempotency_record
  DROP CONSTRAINT idempotency_record_check;

ALTER TABLE idempotency_record
  ADD COLUMN simulation_key text NOT NULL DEFAULT '',
  ADD COLUMN stable_task_id uuid,
  ADD COLUMN state text NOT NULL DEFAULT 'COMPLETE'
    CHECK (state IN ('PENDING', 'COMPLETE')),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

ALTER TABLE idempotency_record
  DROP CONSTRAINT idempotency_record_pkey;

ALTER TABLE idempotency_record
  ADD PRIMARY KEY (
    authorization_context_hash,
    operation_name,
    idempotency_key,
    execution_mode,
    simulation_key
  );

ALTER TABLE idempotency_record
  ADD CONSTRAINT idempotency_record_payload_check CHECK (
    (state = 'PENDING' AND stable_task_id IS NOT NULL AND task_id IS NULL AND synchronous_result IS NULL)
    OR
    (state = 'COMPLETE' AND ((task_id IS NULL) <> (synchronous_result IS NULL)))
  );

CREATE INDEX idempotency_record_pending_idx
  ON idempotency_record (updated_at)
  WHERE state = 'PENDING';
