CREATE TABLE IF NOT EXISTS catalog_snapshot (
  provider_id text NOT NULL REFERENCES provider(provider_id),
  revision bigint NOT NULL CHECK (revision > 0),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  catalog_document jsonb NOT NULL CHECK (jsonb_typeof(catalog_document) = 'object'),
  discovered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (provider_id, revision),
  UNIQUE (provider_id, checksum)
);

CREATE INDEX IF NOT EXISTS catalog_snapshot_history_idx
  ON catalog_snapshot (provider_id, revision DESC);

CREATE TABLE IF NOT EXISTS active_catalog_snapshot (
  provider_id text PRIMARY KEY REFERENCES provider(provider_id),
  revision bigint NOT NULL,
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (provider_id, revision)
    REFERENCES catalog_snapshot(provider_id, revision),
  UNIQUE (provider_id, checksum)
);

CREATE OR REPLACE FUNCTION pms_reject_catalog_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PMS_CATALOG_SNAPSHOT_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS catalog_snapshot_immutable_guard ON catalog_snapshot;

CREATE TRIGGER catalog_snapshot_immutable_guard
BEFORE UPDATE OR DELETE ON catalog_snapshot
FOR EACH ROW
EXECUTE FUNCTION pms_reject_catalog_snapshot_mutation();
