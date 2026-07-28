CREATE TABLE IF NOT EXISTS runtime_registration (
  runtime_instance_id text PRIMARY KEY
    CHECK (runtime_instance_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  deployment_id text NOT NULL,
  session_id text NOT NULL CHECK (btrim(session_id) <> ''),
  protocol_version text NOT NULL CHECK (btrim(protocol_version) <> ''),
  heartbeat_sequence bigint NOT NULL CHECK (heartbeat_sequence >= 0),
  registered_at timestamptz NOT NULL,
  last_heartbeat_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  UNIQUE (deployment_id, runtime_instance_id),
  FOREIGN KEY (deployment_id, runtime_instance_id)
    REFERENCES runtime_process(deployment_id, runtime_instance_id) ON DELETE CASCADE,
  CHECK (last_heartbeat_at >= registered_at),
  CHECK (expires_at > last_heartbeat_at)
);
