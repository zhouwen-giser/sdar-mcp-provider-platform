CREATE TABLE IF NOT EXISTS pms_schema_migration (
  version text PRIMARY KEY CHECK (version ~ '^[0-9]{3}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS provider_type (
  provider_type_id text PRIMARY KEY
    CHECK (provider_type_id ~ '^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$'),
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  status text NOT NULL CHECK (status IN ('active', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS provider_package (
  package_id text NOT NULL CHECK (package_id ~ '^[a-z0-9][a-z0-9._-]{2,127}$'),
  package_version text NOT NULL
    CHECK (package_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$'),
  provider_type_id text NOT NULL REFERENCES provider_type(provider_type_id),
  hosting_modes text[] NOT NULL,
  adapter_entry jsonb NOT NULL CHECK (jsonb_typeof(adapter_entry) = 'object'),
  config_schema jsonb NOT NULL CHECK (jsonb_typeof(config_schema) = 'object'),
  migration_set text,
  qualification jsonb NOT NULL CHECK (jsonb_typeof(qualification) = 'object'),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('available', 'quarantined', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (cardinality(hosting_modes) > 0),
  CHECK (cardinality(hosting_modes) <= 2),
  CHECK (hosting_modes <@ ARRAY['vendor_managed', 'platform_managed']::text[]),
  CHECK (
    cardinality(hosting_modes) = 1
    OR hosting_modes[1] <> hosting_modes[2]
  ),
  CHECK (migration_set IS NULL OR btrim(migration_set) <> ''),
  CHECK (updated_at >= created_at),
  PRIMARY KEY (package_id, package_version),
  UNIQUE (provider_type_id, package_version)
);

CREATE TABLE IF NOT EXISTS provider (
  provider_id text PRIMARY KEY CHECK (provider_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_type_id text NOT NULL REFERENCES provider_type(provider_type_id),
  package_id text,
  package_version text,
  hosting_mode text NOT NULL DEFAULT 'vendor_managed'
    CHECK (hosting_mode IN ('vendor_managed', 'platform_managed')),
  adapter_endpoint text CHECK (adapter_endpoint IS NULL OR btrim(adapter_endpoint) <> ''),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'degraded', 'disabled', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (package_id IS NULL AND package_version IS NULL)
    OR
    (package_id IS NOT NULL AND package_version IS NOT NULL)
  ),
  CHECK (updated_at >= created_at),
  FOREIGN KEY (package_id, package_version)
    REFERENCES provider_package(package_id, package_version)
);

CREATE INDEX IF NOT EXISTS provider_provider_type_idx
  ON provider (provider_type_id, status);

CREATE TABLE IF NOT EXISTS resource (
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  resource_id text NOT NULL CHECK (resource_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  resource_type text NOT NULL CHECK (btrim(resource_type) <> ''),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object'),
  status text NOT NULL CHECK (status IN ('available', 'unavailable', 'retired')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, resource_id),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS resource_type_status_idx
  ON resource (environment, resource_type, status);

CREATE TABLE IF NOT EXISTS provider_resource_binding (
  provider_id text NOT NULL REFERENCES provider(provider_id) ON DELETE CASCADE,
  environment text NOT NULL,
  resource_id text NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_id, environment, resource_id),
  FOREIGN KEY (environment, resource_id)
    REFERENCES resource(environment, resource_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS provider_resource_binding_resource_idx
  ON provider_resource_binding (environment, resource_id, provider_id);

CREATE TABLE IF NOT EXISTS config_definition (
  definition_id uuid PRIMARY KEY,
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  target_type text NOT NULL CHECK (
    target_type IN (
      'environment',
      'provider_type',
      'provider',
      'runtime_deployment',
      'runtime_instance',
      'collector'
    )
  ),
  target_id text NOT NULL CHECK (btrim(target_id) <> ''),
  config_group text NOT NULL CHECK (btrim(config_group) <> ''),
  data_id text NOT NULL CHECK (btrim(data_id) <> ''),
  schema_document jsonb NOT NULL CHECK (jsonb_typeof(schema_document) = 'object'),
  default_content jsonb NOT NULL CHECK (jsonb_typeof(default_content) = 'object'),
  secret_paths jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(secret_paths) = 'array'),
  field_metadata jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(field_metadata) = 'object'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deprecated')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (environment, target_type, target_id, config_group, data_id),
  CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS config_revision (
  revision_id uuid PRIMARY KEY,
  definition_id uuid NOT NULL REFERENCES config_definition(definition_id),
  revision bigint NOT NULL CHECK (revision > 0),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  apply_mode text NOT NULL CHECK (
    apply_mode IN ('hot_reload', 'reconnect_required', 'restart_required', 'immutable')
  ),
  status text NOT NULL CHECK (
    status IN ('draft', 'validated', 'published', 'superseded', 'rejected')
  ),
  content jsonb NOT NULL CHECK (jsonb_typeof(content) = 'object'),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  UNIQUE (definition_id, revision),
  CHECK (published_at IS NULL OR published_at >= created_at),
  CHECK ((status = 'published') = (published_at IS NOT NULL) OR status = 'superseded')
);

CREATE UNIQUE INDEX IF NOT EXISTS config_revision_one_published_idx
  ON config_revision (definition_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS config_revision_definition_created_idx
  ON config_revision (definition_id, revision DESC);

CREATE TABLE IF NOT EXISTS config_ack (
  ack_id uuid PRIMARY KEY,
  revision_id uuid NOT NULL REFERENCES config_revision(revision_id) ON DELETE CASCADE,
  runtime_instance_id text NOT NULL CHECK (btrim(runtime_instance_id) <> ''),
  status text NOT NULL CHECK (
    status IN ('applied', 'rejected', 'restart_required', 'stale', 'unavailable')
  ),
  applied_checksum char(64) CHECK (applied_checksum ~ '^[0-9a-f]{64}$'),
  reason_code text CHECK (reason_code IS NULL OR btrim(reason_code) <> ''),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (revision_id, runtime_instance_id)
);

CREATE INDEX IF NOT EXISTS config_ack_runtime_instance_idx
  ON config_ack (runtime_instance_id, acknowledged_at DESC);

CREATE TABLE IF NOT EXISTS audit (
  audit_event_id uuid PRIMARY KEY,
  action text NOT NULL CHECK (btrim(action) <> ''),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  correlation_id text NOT NULL CHECK (btrim(correlation_id) <> ''),
  subject_type text NOT NULL CHECK (btrim(subject_type) <> ''),
  subject_id text NOT NULL CHECK (btrim(subject_id) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS audit_subject_occurred_idx
  ON audit (subject_type, subject_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS audit_correlation_idx
  ON audit (correlation_id);

CREATE TABLE IF NOT EXISTS job_lease (
  job_id text PRIMARY KEY CHECK (btrim(job_id) <> ''),
  job_type text NOT NULL CHECK (btrim(job_type) <> ''),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  status text NOT NULL CHECK (status IN ('pending', 'leased', 'succeeded', 'failed')),
  lease_owner text,
  lease_token uuid,
  lease_expires_at timestamptz,
  fencing_token bigint NOT NULL DEFAULT 0 CHECK (fencing_token >= 0),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (status = 'leased' AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR
    (status <> 'leased' AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL)
  ),
  CHECK (lease_owner IS NULL OR btrim(lease_owner) <> ''),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS job_lease_claim_idx
  ON job_lease (available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS job_lease_expiry_idx
  ON job_lease (lease_expires_at)
  WHERE status = 'leased';
