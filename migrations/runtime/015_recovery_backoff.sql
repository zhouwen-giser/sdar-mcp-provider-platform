ALTER TABLE provider_task
  ADD COLUMN next_recovery_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN recovery_failure_count integer NOT NULL DEFAULT 0
    CHECK (recovery_failure_count >= 0);

CREATE INDEX provider_task_recovery_due_idx
  ON provider_task (next_recovery_at, last_reconciled_at, task_id)
  WHERE internal_state NOT LIKE 'TERMINAL_%' AND internal_state <> 'SCHEDULED';
