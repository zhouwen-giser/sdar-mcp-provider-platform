CREATE TABLE IF NOT EXISTS provider_business_event_stream_generation (
  provider_id text NOT NULL,
  stream_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('current', 'rotating', 'replayable_closed', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  rotated_to_stream_id uuid,
  reset_reason text,
  affected_source_ids text[] NOT NULL DEFAULT '{}',
  last_replayable_sequence bigint NOT NULL DEFAULT 0 CHECK (last_replayable_sequence >= 0),
  last_continuous_sequence bigint CHECK (last_continuous_sequence >= 0),
  current_sequence bigint NOT NULL DEFAULT 0 CHECK (current_sequence >= 0),
  earliest_available_sequence bigint NOT NULL DEFAULT 1 CHECK (earliest_available_sequence > 0),
  last_deleted_sequence bigint NOT NULL DEFAULT 0 CHECK (last_deleted_sequence >= 0),
  continuity_class text NOT NULL CHECK (continuity_class IN ('all_durable', 'mixed', 'best_effort_only')),
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (provider_id, stream_id),
  FOREIGN KEY (provider_id, rotated_to_stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id),
  CHECK ((status = 'current' AND closed_at IS NULL) OR (status <> 'current')),
  CHECK (last_deleted_sequence < earliest_available_sequence),
  CHECK (earliest_available_sequence <= current_sequence + 1),
  CHECK (last_replayable_sequence <= current_sequence),
  CHECK (last_continuous_sequence IS NULL OR continuity_class = 'all_durable')
);

CREATE UNIQUE INDEX IF NOT EXISTS provider_business_event_one_current_idx
  ON provider_business_event_stream_generation(provider_id)
  WHERE status = 'current';

CREATE INDEX IF NOT EXISTS provider_business_event_generation_retention_idx
  ON provider_business_event_stream_generation(retain_until, provider_id, stream_id)
  WHERE status <> 'current';

CREATE TABLE IF NOT EXISTS provider_business_event_runtime_state (
  provider_id text PRIMARY KEY,
  current_stream_id uuid NOT NULL,
  generation_version bigint NOT NULL CHECK (generation_version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (provider_id, current_stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS provider_business_event_generation_source (
  provider_id text NOT NULL,
  runtime_stream_id uuid NOT NULL,
  source_id text NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_stream_id uuid NOT NULL,
  delivery_semantics text NOT NULL CHECK (delivery_semantics IN ('durable_at_least_once', 'best_effort_live')),
  joined_at_runtime_sequence bigint NOT NULL CHECK (joined_at_runtime_sequence >= 0),
  left_at_runtime_sequence bigint CHECK (left_at_runtime_sequence >= joined_at_runtime_sequence),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_id, runtime_stream_id, source_id),
  FOREIGN KEY (provider_id, runtime_stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id)
    ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS provider_business_event_continuity_record (
  continuity_record_id uuid PRIMARY KEY,
  provider_id text NOT NULL,
  previous_stream_id uuid NOT NULL,
  new_stream_id uuid NOT NULL,
  reason_code text NOT NULL,
  affected_source_ids text[] NOT NULL,
  gap_detected_at timestamptz NOT NULL,
  last_replayable_sequence bigint NOT NULL CHECK (last_replayable_sequence >= 0),
  last_continuous_sequence bigint CHECK (last_continuous_sequence >= 0),
  continuity_reason_identity text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  retain_until timestamptz NOT NULL,
  UNIQUE (provider_id, previous_stream_id, continuity_reason_identity),
  FOREIGN KEY (provider_id, previous_stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id) ON DELETE RESTRICT,
  FOREIGN KEY (provider_id, new_stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id) ON DELETE RESTRICT,
  CHECK (cardinality(affected_source_ids) > 0),
  CHECK (last_continuous_sequence IS NULL OR last_continuous_sequence <= last_replayable_sequence)
);

CREATE INDEX IF NOT EXISTS provider_business_event_continuity_previous_idx
  ON provider_business_event_continuity_record(provider_id, previous_stream_id, created_at);

CREATE TABLE IF NOT EXISTS adapter_business_event_source_state (
  provider_id text NOT NULL,
  source_id text NOT NULL CHECK (source_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  source_stream_id uuid NOT NULL,
  delivery_semantics text NOT NULL CHECK (delivery_semantics IN ('durable_at_least_once', 'best_effort_live')),
  status text NOT NULL CHECK (status IN (
    'active', 'degraded', 'unavailable', 'blocked_contract_violation',
    'blocked_identity_conflict', 'continuity_loss_pending', 'disabled'
  )),
  last_persisted_source_sequence bigint NOT NULL DEFAULT 0 CHECK (last_persisted_source_sequence >= 0),
  last_finalized_source_sequence bigint NOT NULL DEFAULT 0 CHECK (last_finalized_source_sequence >= 0),
  lease_owner text,
  lease_until timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  last_seen_at timestamptz,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_id, source_id),
  CHECK (last_finalized_source_sequence <= last_persisted_source_sequence),
  CHECK ((lease_owner IS NULL) = (lease_until IS NULL))
);

CREATE INDEX IF NOT EXISTS adapter_business_event_source_lease_idx
  ON adapter_business_event_source_state(lease_until, provider_id, source_id);

CREATE TABLE IF NOT EXISTS adapter_business_event_inbox (
  inbox_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider_id text NOT NULL,
  source_id text NOT NULL,
  source_stream_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN (
    'received', 'pending_mapping', 'ready', 'continuity_loss_pending',
    'rejected', 'mapping_failed', 'published', 'terminal_skipped'
  )),
  raw_envelope_json jsonb,
  raw_envelope_hash text NOT NULL CHECK (raw_envelope_hash ~ '^sha256:[0-9a-f]{64}$'),
  transport_payload_hash text CHECK (transport_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  decode_status text NOT NULL CHECK (decode_status IN ('decoded', 'partially_decoded', 'undecodable')),
  reject_reason text,
  normalized_source_event_id text,
  normalized_source_sequence bigint,
  normalized_scope text,
  normalized_occurred_at timestamptz,
  normalized_event_type text,
  source_canonical_hash text CHECK (source_canonical_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_payload jsonb,
  mapping_deadline timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text,
  retain_until timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finalized_at timestamptz,
  FOREIGN KEY (provider_id, source_id)
    REFERENCES adapter_business_event_source_state(provider_id, source_id) ON DELETE RESTRICT,
  CHECK (normalized_source_sequence IS NULL OR normalized_source_sequence > 0),
  CHECK (
    decode_status <> 'decoded' OR status = 'rejected' OR (
      normalized_source_event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$' AND
      normalized_source_sequence IS NOT NULL AND
      normalized_scope IN ('task', 'resource') AND
      normalized_occurred_at IS NOT NULL AND
      normalized_event_type ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$' AND
      source_canonical_hash IS NOT NULL AND
      source_payload IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS adapter_business_event_inbox_event_identity_idx
  ON adapter_business_event_inbox(provider_id, source_id, source_stream_id, normalized_source_event_id)
  WHERE normalized_source_event_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS adapter_business_event_inbox_sequence_idx
  ON adapter_business_event_inbox(provider_id, source_id, source_stream_id, normalized_source_sequence)
  WHERE normalized_source_sequence IS NOT NULL;

CREATE INDEX IF NOT EXISTS adapter_business_event_inbox_barrier_idx
  ON adapter_business_event_inbox(provider_id, source_id, source_stream_id, normalized_source_sequence)
  WHERE status IN ('received', 'pending_mapping', 'ready', 'continuity_loss_pending', 'rejected', 'mapping_failed');

CREATE INDEX IF NOT EXISTS adapter_business_event_inbox_retention_idx
  ON adapter_business_event_inbox(retain_until, inbox_id)
  WHERE status IN ('published', 'terminal_skipped', 'rejected', 'mapping_failed');

CREATE TABLE IF NOT EXISTS provider_business_event (
  provider_id text NOT NULL,
  stream_id uuid NOT NULL,
  sequence bigint NOT NULL CHECK (sequence > 0),
  event_id char(43) NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_-]{43}$'),
  source_id text NOT NULL,
  source_stream_id uuid NOT NULL,
  source_event_id text NOT NULL CHECK (source_event_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,255}$'),
  source_sequence bigint NOT NULL CHECK (source_sequence > 0),
  source_canonical_hash text NOT NULL CHECK (source_canonical_hash ~ '^sha256:[0-9a-f]{64}$'),
  stored_event_hash text NOT NULL CHECK (stored_event_hash ~ '^sha256:[0-9a-f]{64}$'),
  event_type text NOT NULL CHECK (event_type ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  occurred_at timestamptz NOT NULL,
  scope text NOT NULL CHECK (scope IN ('task', 'resource')),
  description text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 4096),
  task_id uuid,
  resource_ref text,
  candidate_related_task_count integer NOT NULL DEFAULT 0 CHECK (candidate_related_task_count >= 0),
  severity_hint text CHECK (severity_hint IN ('info', 'warning', 'critical')),
  reason_code text CHECK (reason_code ~ '^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}$'),
  raw_payload jsonb,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (provider_id, stream_id, sequence),
  UNIQUE (provider_id, event_id),
  UNIQUE (provider_id, stream_id, event_id),
  UNIQUE (provider_id, source_id, source_stream_id, source_event_id),
  UNIQUE (provider_id, source_id, source_stream_id, source_sequence),
  FOREIGN KEY (provider_id, stream_id)
    REFERENCES provider_business_event_stream_generation(provider_id, stream_id) ON DELETE RESTRICT,
  CHECK (
    (scope = 'task' AND task_id IS NOT NULL AND resource_ref IS NULL AND candidate_related_task_count = 0) OR
    (scope = 'resource' AND task_id IS NULL AND resource_ref IS NOT NULL)
  ),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS provider_business_event_replay_idx
  ON provider_business_event(provider_id, stream_id, sequence);

CREATE INDEX IF NOT EXISTS provider_business_event_expiry_idx
  ON provider_business_event(expires_at, provider_id, stream_id, sequence);

CREATE TABLE IF NOT EXISTS provider_business_event_relation (
  provider_id text NOT NULL,
  stream_id uuid NOT NULL,
  event_id char(43) NOT NULL,
  task_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (provider_id, stream_id, event_id, task_id),
  UNIQUE (provider_id, stream_id, event_id, ordinal),
  FOREIGN KEY (provider_id, stream_id, event_id)
    REFERENCES provider_business_event(provider_id, stream_id, event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_business_event_relation_task_order_idx
  ON provider_business_event_relation(provider_id, stream_id, event_id, task_id);

CREATE TABLE IF NOT EXISTS provider_task_resource_binding (
  provider_id text NOT NULL,
  task_id uuid NOT NULL,
  resource_ref text NOT NULL CHECK (
    char_length(resource_ref) BETWEEN 1 AND 512 AND resource_ref ~ '^[!-~]+$'
  ),
  operation_snapshot_id uuid NOT NULL,
  authorization_context_hash char(64) NOT NULL CHECK (authorization_context_hash ~ '^[0-9a-f]{64}$'),
  execution_mode text NOT NULL CHECK (execution_mode IN ('live', 'simulation', 'historical-replay')),
  simulation_id text,
  bound_at timestamptz NOT NULL,
  terminal_at timestamptz,
  retain_until timestamptz NOT NULL,
  PRIMARY KEY (provider_id, task_id),
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR (execution_mode <> 'live' AND simulation_id IS NOT NULL)),
  CHECK (terminal_at IS NULL OR terminal_at >= bound_at),
  CHECK (retain_until >= COALESCE(terminal_at, bound_at))
);

CREATE INDEX IF NOT EXISTS provider_task_resource_binding_event_time_idx
  ON provider_task_resource_binding(provider_id, resource_ref, bound_at, terminal_at, task_id);

CREATE INDEX IF NOT EXISTS provider_task_resource_binding_retention_idx
  ON provider_task_resource_binding(retain_until, provider_id, task_id);

CREATE TABLE IF NOT EXISTS provider_task_visibility_tombstone (
  provider_id text NOT NULL,
  task_id uuid NOT NULL,
  authorization_context_hash char(64) NOT NULL CHECK (authorization_context_hash ~ '^[0-9a-f]{64}$'),
  execution_mode text NOT NULL CHECK (execution_mode IN ('live', 'simulation', 'historical-replay')),
  simulation_id text,
  resource_ref text,
  terminal_at timestamptz NOT NULL,
  retain_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_id, task_id),
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR (execution_mode <> 'live' AND simulation_id IS NOT NULL)),
  CHECK (retain_until >= terminal_at)
);

CREATE INDEX IF NOT EXISTS provider_task_visibility_tombstone_retention_idx
  ON provider_task_visibility_tombstone(retain_until, provider_id, task_id);

CREATE TABLE IF NOT EXISTS provider_business_event_relation_projection (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  provider_id text NOT NULL,
  stream_id uuid NOT NULL,
  event_id char(43) NOT NULL,
  authorization_scope_hash char(64) NOT NULL CHECK (authorization_scope_hash ~ '^[0-9a-f]{64}$'),
  execution_mode text NOT NULL CHECK (execution_mode IN ('live', 'simulation', 'historical-replay')),
  simulation_id text,
  candidate_relation_hash text NOT NULL CHECK (candidate_relation_hash ~ '^sha256:[0-9a-f]{64}$'),
  projection_relation_hash text NOT NULL CHECK (projection_relation_hash ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  FOREIGN KEY (provider_id, stream_id, event_id)
    REFERENCES provider_business_event(provider_id, stream_id, event_id) ON DELETE CASCADE,
  CHECK ((execution_mode = 'live' AND simulation_id IS NULL) OR (execution_mode <> 'live' AND simulation_id IS NOT NULL)),
  CHECK (expires_at > created_at)
);

CREATE TABLE IF NOT EXISTS provider_business_event_relation_projection_item (
  token_hash char(64) NOT NULL,
  task_id uuid NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY (token_hash, task_id),
  UNIQUE (token_hash, ordinal),
  FOREIGN KEY (token_hash)
    REFERENCES provider_business_event_relation_projection(token_hash) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_business_event_projection_page_idx
  ON provider_business_event_relation_projection_item(token_hash, task_id);

CREATE INDEX IF NOT EXISTS provider_business_event_projection_expiry_idx
  ON provider_business_event_relation_projection(expires_at, token_hash);
