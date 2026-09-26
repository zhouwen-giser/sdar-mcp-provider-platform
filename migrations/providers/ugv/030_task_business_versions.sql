-- Native Provider business history. No FK to Runtime Task publication or
-- ugv_execution: Provider evidence can precede the Runtime Task row.
CREATE TABLE IF NOT EXISTS ugv_task_business_context (
  scope_hash text PRIMARY KEY CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  scope_key text NOT NULL,
  task_id text NOT NULL,
  external_execution_id text NOT NULL,
  context_revision bigint NOT NULL CHECK (context_revision >= 0),
  effective_plan_revision bigint NOT NULL CHECK (effective_plan_revision >= 0),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ugv_task_business_context_task_idx
  ON ugv_task_business_context(task_id, external_execution_id);

CREATE TABLE IF NOT EXISTS ugv_task_business_object_version (
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  scope_key text NOT NULL,
  object_kind text NOT NULL CHECK (object_kind IN ('artifact','action','input_request','intervention')),
  object_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  written_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope_hash, object_kind, object_id, revision)
);

CREATE TABLE IF NOT EXISTS ugv_task_business_command (
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  scope_key text NOT NULL,
  command_id text NOT NULL,
  command_type text NOT NULL CHECK (command_type IN ('input_response','intervention')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('accepted','applied','rejected')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (scope_hash, command_id)
);

CREATE INDEX IF NOT EXISTS ugv_task_business_command_created_idx
  ON ugv_task_business_command(scope_hash, created_at);
