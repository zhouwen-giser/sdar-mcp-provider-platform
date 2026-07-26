CREATE TABLE IF NOT EXISTS operation_snapshot (
  snapshot_id uuid PRIMARY KEY,
  provider_id text NOT NULL CHECK (provider_id <> ''),
  provider_version text NOT NULL CHECK (provider_version <> ''),
  operation_name text NOT NULL CHECK (operation_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  manifest_hash char(64) NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider_id, provider_version, operation_name, manifest_hash)
);

CREATE INDEX operation_snapshot_provider_manifest_idx
  ON operation_snapshot (provider_id, manifest_hash);
