ALTER TABLE provider_task
  ALTER COLUMN external_execution_id DROP NOT NULL;

ALTER TABLE provider_task
  ADD COLUMN not_before timestamptz,
  ADD COLUMN schedule_claim_owner text,
  ADD COLUMN schedule_claim_until timestamptz;

ALTER TABLE task_observation
  DROP CONSTRAINT task_observation_revision_check;

ALTER TABLE task_observation
  ADD CONSTRAINT task_observation_revision_check CHECK (revision >= 0);

CREATE INDEX provider_task_schedule_due_idx
  ON provider_task (not_before, latest_start_at, task_id)
  WHERE internal_state = 'SCHEDULED';

CREATE INDEX provider_task_deadline_due_idx
  ON provider_task (deadline_at, task_id)
  WHERE deadline_at IS NOT NULL AND internal_state NOT LIKE 'TERMINAL_%';
