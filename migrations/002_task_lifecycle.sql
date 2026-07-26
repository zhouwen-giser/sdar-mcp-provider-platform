CREATE TABLE provider_task (
  task_id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  operation_name text NOT NULL,
  operation_snapshot_id uuid NOT NULL REFERENCES operation_snapshot(snapshot_id),
  authorization_context_hash char(64) NOT NULL,
  execution_mode text NOT NULL CHECK (execution_mode IN ('live', 'simulation', 'historical-replay')),
  simulation_id text,
  arguments jsonb NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
  argument_hash char(64) NOT NULL,
  external_execution_id text NOT NULL,
  internal_state text NOT NULL CHECK (internal_state IN (
    'SCHEDULED', 'STARTING', 'QUEUED', 'RUNNING', 'PAUSED', 'RESUMING',
    'INPUT_REQUIRED', 'STOPPING', 'TERMINAL_COMPLETED', 'TERMINAL_FAILED',
    'TERMINAL_CANCELLED'
  )),
  mcp_status text NOT NULL CHECK (mcp_status IN ('working', 'input_required', 'completed', 'failed', 'cancelled')),
  substate text CHECK (substate IN ('scheduled', 'queued', 'running', 'paused', 'resuming', 'stopping')),
  status_message text,
  result jsonb,
  error jsonb,
  adapter_revision bigint NOT NULL DEFAULT 0 CHECK (adapter_revision >= 0),
  timing jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(timing) = 'object'),
  accepted_at timestamptz NOT NULL,
  actual_started_at timestamptz,
  latest_start_at timestamptz,
  deadline_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  stop_reason text,
  ttl_ms bigint CHECK (ttl_ms IS NULL OR ttl_ms > 0),
  poll_interval_ms integer NOT NULL DEFAULT 2000 CHECK (poll_interval_ms >= 250),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL DEFAULT 0 CHECK (version >= 0),
  UNIQUE (provider_id, external_execution_id),
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR
         (execution_mode <> 'live' AND simulation_id IS NOT NULL))
);

CREATE TABLE admission_intent (
  task_id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  operation_name text NOT NULL,
  operation_snapshot_id uuid NOT NULL REFERENCES operation_snapshot(snapshot_id),
  authorization_context_hash char(64) NOT NULL,
  execution_mode text NOT NULL CHECK (execution_mode IN ('live', 'simulation', 'historical-replay')),
  simulation_id text,
  arguments jsonb NOT NULL CHECK (jsonb_typeof(arguments) = 'object'),
  argument_hash char(64) NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING', 'ACCEPTED', 'REJECTED', 'PUBLISHED', 'UNCERTAIN')),
  invocation_attempt integer NOT NULL DEFAULT 1 CHECK (invocation_attempt > 0),
  adapter_response jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR
         (execution_mode <> 'live' AND simulation_id IS NOT NULL))
);

CREATE TABLE task_observation (
  task_id uuid NOT NULL REFERENCES provider_task(task_id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0),
  type text NOT NULL,
  reason_code text,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (task_id, revision)
);

CREATE TABLE task_input_request (
  task_id uuid NOT NULL REFERENCES provider_task(task_id) ON DELETE CASCADE,
  request_key text NOT NULL,
  schema jsonb NOT NULL CHECK (jsonb_typeof(schema) = 'object'),
  status text NOT NULL CHECK (status IN ('OPEN', 'ANSWERED')),
  answer_hash char(64),
  answer jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  answered_at timestamptz,
  PRIMARY KEY (task_id, request_key)
);

CREATE TABLE idempotency_record (
  authorization_context_hash char(64) NOT NULL,
  operation_name text NOT NULL,
  idempotency_key text NOT NULL,
  argument_hash char(64) NOT NULL,
  execution_mode text NOT NULL,
  task_id uuid REFERENCES provider_task(task_id),
  synchronous_result jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz,
  PRIMARY KEY (authorization_context_hash, operation_name, idempotency_key, execution_mode),
  CHECK ((task_id IS NULL) <> (synchronous_result IS NULL))
);

CREATE TABLE outbox_event (
  event_id uuid PRIMARY KEY,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  delivery_attempts integer NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0)
);

CREATE TABLE runtime_lease (
  lease_key text PRIMARY KEY,
  owner_id text NOT NULL,
  fencing_token bigint NOT NULL CHECK (fencing_token > 0),
  expires_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX provider_task_nonterminal_idx
  ON provider_task (internal_state, updated_at)
  WHERE internal_state NOT LIKE 'TERMINAL_%';
CREATE INDEX provider_task_owner_idx
  ON provider_task (authorization_context_hash, execution_mode, task_id);
CREATE INDEX admission_intent_pending_idx
  ON admission_intent (state, updated_at)
  WHERE state IN ('PENDING', 'ACCEPTED', 'UNCERTAIN');
CREATE INDEX outbox_event_pending_idx
  ON outbox_event (created_at)
  WHERE published_at IS NULL;
