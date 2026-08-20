CREATE TABLE IF NOT EXISTS ugv_mutation_journal (
  task_id text NOT NULL REFERENCES ugv_execution(task_id) ON DELETE CASCADE,
  step_id text NOT NULL,
  phase text NOT NULL CHECK (
    phase IN ('PRIMARY','FOLLOWUP','PAUSE','RESUME','CANCEL','EMERGENCY_STOP','CLEANUP')
  ),
  tool_name text NOT NULL,
  argument_hash text NOT NULL CHECK (argument_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (
    state IN ('INTENT_PERSISTED','DISPATCHING','ACCEPTED','REJECTED','UNCERTAIN')
  ),
  external_mission_id text,
  result_hash text CHECK (result_hash IS NULL OR result_hash ~ '^[a-f0-9]{64}$'),
  intent_persisted_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  completed_at timestamptz,
  payload jsonb NOT NULL,
  PRIMARY KEY (task_id, step_id),
  CHECK (length(step_id) BETWEEN 1 AND 256),
  CHECK (length(tool_name) BETWEEN 1 AND 256),
  CHECK (external_mission_id IS NULL OR length(external_mission_id) BETWEEN 1 AND 256),
  CHECK (dispatched_at IS NULL OR dispatched_at >= intent_persisted_at),
  CHECK (completed_at IS NULL OR (dispatched_at IS NOT NULL AND completed_at >= dispatched_at)),
  CHECK (
    (state = 'INTENT_PERSISTED' AND dispatched_at IS NULL AND completed_at IS NULL)
    OR (state = 'DISPATCHING' AND dispatched_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('ACCEPTED','REJECTED','UNCERTAIN')
        AND dispatched_at IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS ugv_mutation_journal_state_idx
  ON ugv_mutation_journal(task_id, state, intent_persisted_at);
