CREATE TABLE smpp_dispatch_uncertainty (
  task_id uuid PRIMARY KEY REFERENCES admission_intent(task_id) ON DELETE CASCADE,
  operation_name text NOT NULL,
  argument_hash char(64) NOT NULL,
  uncertainty_class text NOT NULL CHECK (uncertainty_class IN (
    'response_lost_after_adapter_success',
    'adapter_transport_ambiguous',
    'runtime_crash_window',
    'unknown'
  )),
  redispatch_allowed boolean NOT NULL DEFAULT false CHECK (redispatch_allowed = false),
  occurred_at timestamptz NOT NULL,
  causal_refs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(causal_refs) = 'array'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX smpp_dispatch_uncertainty_occurred_idx
  ON smpp_dispatch_uncertainty (occurred_at, task_id);
