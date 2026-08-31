CREATE TABLE smpp_reconciliation_audit (
  task_id uuid NOT NULL REFERENCES admission_intent(task_id) ON DELETE CASCADE,
  attempt integer NOT NULL CHECK (attempt > 0),
  operation_name text NOT NULL,
  argument_hash char(64) NOT NULL,
  authorization_context_hash char(64) NOT NULL,
  execution_mode text NOT NULL CHECK (execution_mode IN ('live','simulation','historical-replay')),
  simulation_id text,
  status text NOT NULL CHECK (status IN (
    'found','not_found','conflict','transient_unavailable','deferred'
  )),
  external_execution_id text,
  identity_validated boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (task_id, attempt),
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR
         (execution_mode <> 'live' AND simulation_id IS NOT NULL))
);

CREATE INDEX smpp_reconciliation_audit_occurred_idx
  ON smpp_reconciliation_audit (occurred_at, task_id, attempt);
