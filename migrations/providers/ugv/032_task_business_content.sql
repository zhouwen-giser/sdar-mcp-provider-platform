-- Immutable exact-version bytes for content_ref Artifact representations.
-- The enclosing Store transaction also writes the matching object and Context.
CREATE TABLE IF NOT EXISTS ugv_task_business_content (
  scope_hash text NOT NULL CHECK (scope_hash ~ '^[0-9a-f]{64}$'),
  scope_key text NOT NULL,
  artifact_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  handle text NOT NULL,
  media_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes >= 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope_hash, handle),
  UNIQUE (scope_hash, artifact_id, revision, handle)
);
CREATE INDEX IF NOT EXISTS ugv_task_business_content_version_idx
  ON ugv_task_business_content(scope_hash, artifact_id, revision);

CREATE OR REPLACE FUNCTION reject_ugv_task_business_content_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ARTIFACT_CONTENT_IMMUTABLE' USING ERRCODE='55000';
END;
$$;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='ugv_task_business_content'::regclass
    AND tgname='ugv_task_business_content_immutable') THEN
    CREATE TRIGGER ugv_task_business_content_immutable
      BEFORE UPDATE OR DELETE ON ugv_task_business_content
      FOR EACH ROW EXECUTE FUNCTION reject_ugv_task_business_content_mutation();
  END IF;
END;
$$;
