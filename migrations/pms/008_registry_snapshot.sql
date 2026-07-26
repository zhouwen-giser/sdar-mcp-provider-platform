CREATE TABLE IF NOT EXISTS registry_snapshot (
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  revision bigint NOT NULL CHECK (revision > 0),
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  registry_document jsonb NOT NULL CHECK (jsonb_typeof(registry_document) = 'object'),
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (environment, revision),
  UNIQUE (environment, checksum)
);

CREATE INDEX IF NOT EXISTS registry_snapshot_history_idx
  ON registry_snapshot (environment, revision DESC);

CREATE TABLE IF NOT EXISTS active_registry_snapshot (
  environment text PRIMARY KEY CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  revision bigint NOT NULL,
  checksum char(64) NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (environment, revision)
    REFERENCES registry_snapshot(environment, revision),
  UNIQUE (environment, checksum)
);

CREATE OR REPLACE FUNCTION pms_reject_registry_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PMS_REGISTRY_SNAPSHOT_IMMUTABLE'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS registry_snapshot_immutable_guard ON registry_snapshot;

CREATE TRIGGER registry_snapshot_immutable_guard
BEFORE UPDATE OR DELETE ON registry_snapshot
FOR EACH ROW
EXECUTE FUNCTION pms_reject_registry_snapshot_mutation();
