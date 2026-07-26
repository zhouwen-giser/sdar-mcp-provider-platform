ALTER TABLE admission_intent
  ADD COLUMN accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN ttl_ms bigint CHECK (ttl_ms IS NULL OR ttl_ms > 0),
  ADD COLUMN timing jsonb NOT NULL DEFAULT '{"start":{"mode":"immediate","startToleranceMs":0},"maxElapsedMs":null}'::jsonb
    CHECK (jsonb_typeof(timing) = 'object'),
  ADD COLUMN not_before timestamptz,
  ADD COLUMN latest_start_at timestamptz,
  ADD COLUMN deadline_at timestamptz;

UPDATE admission_intent
SET not_before = accepted_at,
    latest_start_at = accepted_at
WHERE not_before IS NULL OR latest_start_at IS NULL;

ALTER TABLE admission_intent
  ALTER COLUMN not_before SET NOT NULL,
  ALTER COLUMN latest_start_at SET NOT NULL;

ALTER TABLE provider_task
  ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0 CHECK (recovery_attempts >= 0),
  ADD COLUMN last_reconciled_at timestamptz;

CREATE INDEX provider_task_recovery_idx
  ON provider_task (updated_at, task_id)
  WHERE internal_state NOT LIKE 'TERMINAL_%' AND internal_state <> 'SCHEDULED';

CREATE INDEX admission_intent_recovery_idx
  ON admission_intent (updated_at, task_id)
  WHERE state IN ('PENDING', 'UNCERTAIN');
