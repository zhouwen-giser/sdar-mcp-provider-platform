ALTER TABLE provider_task
  ADD COLUMN start_stop_requested_at timestamptz,
  ADD COLUMN invocation_attempt integer NOT NULL DEFAULT 0 CHECK (invocation_attempt >= 0),
  ADD COLUMN next_start_attempt_at timestamptz;

UPDATE provider_task
SET next_start_attempt_at = COALESCE(not_before, accepted_at)
WHERE internal_state = 'SCHEDULED';

CREATE INDEX provider_task_immediate_start_watchdog_idx
  ON provider_task (latest_start_at, task_id)
  WHERE internal_state NOT LIKE 'TERMINAL_%'
    AND actual_started_at IS NULL;

CREATE INDEX provider_task_schedule_retry_due_idx
  ON provider_task (next_start_attempt_at, latest_start_at, task_id)
  WHERE internal_state = 'SCHEDULED';

CREATE INDEX provider_task_schedule_reconcile_due_idx
  ON provider_task (schedule_claim_until, task_id)
  WHERE internal_state = 'STARTING';
