CREATE SCHEMA IF NOT EXISTS {{schema}};
CREATE TABLE IF NOT EXISTS {{schema}}.install_history (
  version integer PRIMARY KEY,
  checksum text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS {{schema}}.archive_partition (
  partition_hash text PRIMARY KEY,
  identity jsonb NOT NULL,
  canonical_bytes bigint NOT NULL DEFAULT 0 CHECK(canonical_bytes >= 0),
  entry_count bigint NOT NULL DEFAULT 0 CHECK(entry_count >= 0),
  active_session uuid
);
CREATE TABLE IF NOT EXISTS {{schema}}.archive_session (
  session_id uuid PRIMARY KEY,
  partition_hash text NOT NULL REFERENCES {{schema}}.archive_partition(partition_hash),
  started_at timestamptz NOT NULL,
  ended_at timestamptz,
  status text NOT NULL CHECK(status IN ('open','closed','failed','abandoned')),
  genesis_hash text NOT NULL,
  head_hash text NOT NULL,
  last_ordinal bigint NOT NULL DEFAULT 0 CHECK(last_ordinal >= 0),
  failure_code text
);
CREATE INDEX IF NOT EXISTS archive_session_partition_idx
  ON {{schema}}.archive_session(partition_hash, started_at DESC);
CREATE TABLE IF NOT EXISTS {{schema}}.archive_entry (
  session_id uuid NOT NULL REFERENCES {{schema}}.archive_session(session_id),
  ordinal bigint NOT NULL CHECK(ordinal > 0),
  event_id uuid NOT NULL UNIQUE,
  previous_hash text NOT NULL,
  entry_hash text NOT NULL,
  canonical_bytes integer NOT NULL CHECK(canonical_bytes > 0),
  payload jsonb NOT NULL,
  PRIMARY KEY(session_id,ordinal)
);
CREATE OR REPLACE FUNCTION {{schema}}.reject_archive_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ZMQ_ARCHIVE_IMMUTABLE' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS archive_entry_immutable ON {{schema}}.archive_entry;
CREATE TRIGGER archive_entry_immutable BEFORE UPDATE OR DELETE ON {{schema}}.archive_entry
FOR EACH ROW EXECUTE FUNCTION {{schema}}.reject_archive_mutation();
