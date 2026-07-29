CREATE TABLE IF NOT EXISTS runtime_deployment (
  deployment_id text PRIMARY KEY
    CHECK (deployment_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_id text NOT NULL REFERENCES provider(provider_id),
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  desired_state text NOT NULL CHECK (desired_state IN ('running', 'stopped', 'draining')),
  desired_replicas integer NOT NULL CHECK (desired_replicas BETWEEN 0 AND 1),
  runtime_version text NOT NULL CHECK (btrim(runtime_version) <> ''),
  database_profile_id text NOT NULL CHECK (btrim(database_profile_id) <> ''),
  config_profile_id text NOT NULL CHECK (btrim(config_profile_id) <> ''),
  adapter_endpoint text CHECK (adapter_endpoint IS NULL OR btrim(adapter_endpoint) <> ''),
  status text NOT NULL CHECK (
    status IN (
      'REQUESTED',
      'DATABASE_PROVISIONING',
      'MIGRATING',
      'CONFIG_PREPARING',
      'STARTING',
      'HEALTH_CHECKING',
      'DISCOVERING',
      'ACTIVE',
      'STOPPED',
      'DRAINING',
      'DEGRADED',
      'FAILED'
    )
  ),
  desired_revision bigint NOT NULL DEFAULT 0 CHECK (desired_revision >= 0),
  observed_revision bigint NOT NULL DEFAULT 0 CHECK (observed_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (deployment_id, environment),
  CHECK (
    (desired_state = 'running' AND desired_replicas = 1)
    OR
    (desired_state IN ('stopped', 'draining') AND desired_replicas = 0)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS runtime_deployment_provider_state_idx
  ON runtime_deployment (provider_id, environment, desired_state, status);

CREATE TABLE IF NOT EXISTS runtime_process (
  runtime_instance_id text PRIMARY KEY
    CHECK (runtime_instance_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  deployment_id text NOT NULL,
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  pm2_name text NOT NULL UNIQUE
    CHECK (pm2_name ~ '^sdar-runtime-[a-z0-9][a-z0-9-]{0,126}$'),
  pid integer CHECK (pid IS NULL OR pid > 0),
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  process_state text NOT NULL CHECK (
    process_state IN ('missing', 'starting', 'online', 'stopping', 'stopped', 'errored')
  ),
  liveness_state text NOT NULL CHECK (liveness_state IN ('unknown', 'live', 'dead')),
  readiness_state text NOT NULL CHECK (
    readiness_state IN ('unknown', 'ready', 'not_ready')
  ),
  registration_state text NOT NULL CHECK (
    registration_state IN ('unregistered', 'registered', 'identity_mismatch')
  ),
  catalog_state text NOT NULL CHECK (catalog_state IN ('unknown', 'pending', 'valid', 'invalid')),
  config_state text NOT NULL CHECK (
    config_state IN ('unknown', 'current', 'stale', 'rejected', 'restart_required')
  ),
  last_heartbeat_at timestamptz,
  runtime_version text CHECK (runtime_version IS NULL OR btrim(runtime_version) <> ''),
  config_revision bigint CHECK (config_revision IS NULL OR config_revision >= 0),
  restart_count integer NOT NULL DEFAULT 0 CHECK (restart_count >= 0),
  observed_revision bigint NOT NULL DEFAULT 0 CHECK (observed_revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (deployment_id, runtime_instance_id),
  UNIQUE (environment, port),
  FOREIGN KEY (deployment_id, environment)
    REFERENCES runtime_deployment(deployment_id, environment) ON DELETE CASCADE,
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS runtime_process_deployment_state_idx
  ON runtime_process (deployment_id, process_state, readiness_state);

CREATE INDEX IF NOT EXISTS runtime_process_heartbeat_idx
  ON runtime_process (last_heartbeat_at)
  WHERE process_state = 'online';

CREATE TABLE IF NOT EXISTS runtime_deployment_action (
  action_id uuid PRIMARY KEY,
  deployment_id text NOT NULL REFERENCES runtime_deployment(deployment_id) ON DELETE CASCADE,
  runtime_instance_id text,
  action_type text NOT NULL CHECK (action_type ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  idempotency_key text NOT NULL CHECK (btrim(idempotency_key) <> ''),
  status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'noop')),
  expected_revision bigint CHECK (expected_revision IS NULL OR expected_revision >= 0),
  resulting_revision bigint CHECK (resulting_revision IS NULL OR resulting_revision >= 0),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  result_details jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(result_details) = 'object'),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (deployment_id, idempotency_key),
  FOREIGN KEY (deployment_id, runtime_instance_id)
    REFERENCES runtime_process(deployment_id, runtime_instance_id),
  CHECK (
    (status IN ('pending', 'running') AND completed_at IS NULL)
    OR
    (status IN ('succeeded', 'failed', 'noop') AND completed_at IS NOT NULL)
  ),
  CHECK (completed_at IS NULL OR completed_at >= occurred_at)
);

CREATE INDEX IF NOT EXISTS runtime_deployment_action_history_idx
  ON runtime_deployment_action (deployment_id, occurred_at DESC, action_id);

CREATE INDEX IF NOT EXISTS runtime_deployment_action_correlation_idx
  ON runtime_deployment_action (correlation_id, occurred_at DESC);
