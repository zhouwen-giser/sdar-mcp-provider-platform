CREATE TABLE IF NOT EXISTS npc_tank_execution (
  task_id text PRIMARY KEY,
  external_execution_id text UNIQUE NOT NULL,
  operation_name text NOT NULL,
  argument_hash text NOT NULL,
  resource_id text NOT NULL CHECK (resource_id = 'vehicle:npc_tank1'),
  tracks text[] NOT NULL,
  execution_context jsonb NOT NULL,
  downstream_mission_ids text[] NOT NULL DEFAULT '{}',
  state text NOT NULL,
  revision bigint NOT NULL,
  reason_code text NOT NULL,
  progress double precision,
  result jsonb,
  latest_snapshot_revision text,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  terminal_at timestamptz,
  UNIQUE(task_id, operation_name, argument_hash)
);

CREATE TABLE IF NOT EXISTS npc_tank_execution_command_ack (
  task_id text NOT NULL REFERENCES npc_tank_execution(task_id) ON DELETE CASCADE,
  command text NOT NULL,
  command_sequence bigint NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(task_id, command, command_sequence)
);

CREATE TABLE IF NOT EXISTS npc_tank_device_tool_call (
  call_id text PRIMARY KEY,
  task_id text,
  tool_name text NOT NULL CHECK (tool_name LIKE 'npc_tank_%'),
  argument_hash text NOT NULL,
  outcome text NOT NULL,
  duration_ms integer NOT NULL,
  occurred_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS npc_tank_state_snapshot (
  revision text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS npc_tank_business_event_source_state (
  source_id text PRIMARY KEY,
  source_stream_id text UNIQUE NOT NULL,
  next_sequence bigint NOT NULL CHECK(next_sequence > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS npc_tank_business_event_source_log (
  source_id text NOT NULL REFERENCES npc_tank_business_event_source_state(source_id),
  source_sequence bigint NOT NULL,
  source_event_id text NOT NULL,
  source_stream_id text NOT NULL,
  payload_hash text NOT NULL,
  occurred_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(source_id, source_sequence),
  UNIQUE(source_id, source_event_id)
);

CREATE INDEX IF NOT EXISTS npc_tank_business_event_retention_idx
  ON npc_tank_business_event_source_log(retain_until);
