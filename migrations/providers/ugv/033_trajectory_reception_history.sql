-- Forward-only receipt history. Disabling the feature rolls back behavior, not data.
CREATE TABLE IF NOT EXISTS ugv_trajectory_history_stream (
  stream_id uuid PRIMARY KEY,
  scope_hash text NOT NULL UNIQUE CHECK (scope_hash ~ '^[a-f0-9]{64}$'),
  scope_payload jsonb NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  high_watermark bigint NOT NULL DEFAULT 0 CHECK (high_watermark >= 0),
  genesis_hash text NOT NULL CHECK (genesis_hash ~ '^[a-f0-9]{64}$'),
  head_hash text NOT NULL CHECK (head_hash ~ '^[a-f0-9]{64}$'),
  pruned_through bigint NOT NULL DEFAULT 0 CHECK (pruned_through >= 0),
  pruned_head_hash text NOT NULL CHECK (pruned_head_hash ~ '^[a-f0-9]{64}$'),
  capture_failure_count bigint NOT NULL DEFAULT 0 CHECK (capture_failure_count >= 0)
);

CREATE TABLE IF NOT EXISTS ugv_trajectory_history_session (
  session_id uuid PRIMARY KEY,
  stream_id uuid NOT NULL REFERENCES ugv_trajectory_history_stream(stream_id),
  state text NOT NULL CHECK (state IN ('OPEN','CLEAN_CLOSED','UNCLEAN')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  closed_at timestamptz,
  disconnect_count bigint NOT NULL DEFAULT 0 CHECK (disconnect_count >= 0)
);
CREATE INDEX IF NOT EXISTS ugv_trajectory_history_session_stream
  ON ugv_trajectory_history_session(stream_id,state);
CREATE UNIQUE INDEX IF NOT EXISTS ugv_trajectory_history_session_stream_identity
  ON ugv_trajectory_history_session(session_id,stream_id);

CREATE TABLE IF NOT EXISTS ugv_trajectory_history_reception (
  stream_id uuid NOT NULL REFERENCES ugv_trajectory_history_stream(stream_id),
  sequence bigint NOT NULL CHECK (sequence > 0),
  reception_id uuid NOT NULL,
  session_id uuid NOT NULL,
  receipt jsonb NOT NULL,
  recorded_at timestamptz NOT NULL,
  previous_hash text NOT NULL CHECK (previous_hash ~ '^[a-f0-9]{64}$'),
  hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
  PRIMARY KEY(stream_id,sequence),
  UNIQUE(stream_id,reception_id),
  FOREIGN KEY(session_id,stream_id) REFERENCES ugv_trajectory_history_session(session_id,stream_id)
);

CREATE TABLE IF NOT EXISTS ugv_trajectory_history_snapshot (
  snapshot_id uuid PRIMARY KEY,
  stream_id uuid NOT NULL REFERENCES ugv_trajectory_history_stream(stream_id),
  subject_hash text NOT NULL,
  signed_manifest jsonb NOT NULL,
  max_page_bytes integer NOT NULL CHECK (max_page_bytes BETWEEN 8192 AND 1048576),
  page_limit integer NOT NULL CHECK (page_limit BETWEEN 1 AND 256),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS ugv_trajectory_projection_evidence (
  scope_hash text NOT NULL,
  scope_key text NOT NULL,
  device_id text,
  task_id text NOT NULL,
  artifact_id text NOT NULL,
  revision bigint NOT NULL CHECK (revision > 0),
  payload jsonb NOT NULL,
  PRIMARY KEY(scope_hash,artifact_id,revision)
);

CREATE OR REPLACE FUNCTION ugv_trajectory_history_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Only the table owner may execute the explicit retention procedure. A runtime
  -- role setting this GUC cannot bypass the immutable receipt/snapshot trigger.
  IF TG_OP='DELETE' AND TG_TABLE_NAME IN ('ugv_trajectory_history_reception','ugv_trajectory_history_snapshot')
    AND current_setting('smpp.history_owner_prune',true)='on'
    AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'TRAJECTORY_HISTORY_IMMUTABLE' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS ugv_trajectory_reception_immutable ON ugv_trajectory_history_reception;
CREATE TRIGGER ugv_trajectory_reception_immutable BEFORE UPDATE OR DELETE
ON ugv_trajectory_history_reception FOR EACH ROW EXECUTE FUNCTION ugv_trajectory_history_immutable();
DROP TRIGGER IF EXISTS ugv_trajectory_snapshot_immutable ON ugv_trajectory_history_snapshot;
CREATE TRIGGER ugv_trajectory_snapshot_immutable BEFORE UPDATE OR DELETE
ON ugv_trajectory_history_snapshot FOR EACH ROW EXECUTE FUNCTION ugv_trajectory_history_immutable();
DROP TRIGGER IF EXISTS ugv_trajectory_projection_immutable ON ugv_trajectory_projection_evidence;
CREATE TRIGGER ugv_trajectory_projection_immutable BEFORE UPDATE OR DELETE
ON ugv_trajectory_projection_evidence FOR EACH ROW EXECUTE FUNCTION ugv_trajectory_history_immutable();

CREATE OR REPLACE FUNCTION ugv_trajectory_history_stream_identity_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.stream_id IS DISTINCT FROM OLD.stream_id OR NEW.scope_hash IS DISTINCT FROM OLD.scope_hash
    OR NEW.scope_payload IS DISTINCT FROM OLD.scope_payload OR NEW.captured_at IS DISTINCT FROM OLD.captured_at
    OR NEW.genesis_hash IS DISTINCT FROM OLD.genesis_hash THEN
    RAISE EXCEPTION 'TRAJECTORY_HISTORY_SCOPE_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  IF (NEW.pruned_through IS DISTINCT FROM OLD.pruned_through OR NEW.pruned_head_hash IS DISTINCT FROM OLD.pruned_head_hash)
    AND NOT (current_setting('smpp.history_owner_prune',true)='on'
      AND current_user=(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid=TG_RELID)) THEN
    RAISE EXCEPTION 'TRAJECTORY_RETENTION_OWNER_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS ugv_trajectory_history_scope_immutable ON ugv_trajectory_history_stream;
CREATE TRIGGER ugv_trajectory_history_scope_immutable BEFORE UPDATE ON ugv_trajectory_history_stream
FOR EACH ROW EXECUTE FUNCTION ugv_trajectory_history_stream_identity_immutable();

-- Forward retention preserves the chain boundary and geometry sidecars. Behavior
-- rollback is feature disablement; there is no destructive down migration.
CREATE OR REPLACE FUNCTION ugv_trajectory_history_prune(p_scope_hash text,p_through bigint) RETURNS bigint
LANGUAGE plpgsql SET search_path FROM CURRENT AS $$
DECLARE s ugv_trajectory_history_stream%ROWTYPE; anchor text; removed bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_scope_hash,718081));
  SELECT * INTO STRICT s FROM ugv_trajectory_history_stream WHERE scope_hash=p_scope_hash FOR UPDATE;
  IF current_user<>(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='ugv_trajectory_history_stream'::regclass) THEN
    RAISE EXCEPTION 'TRAJECTORY_RETENTION_OWNER_REQUIRED' USING ERRCODE='42501';
  END IF;
  IF p_through<s.pruned_through OR p_through>s.high_watermark THEN
    RAISE EXCEPTION 'TRAJECTORY_RETENTION_BOUNDARY_INVALID' USING ERRCODE='22023';
  END IF;
  IF p_through=s.pruned_through THEN RETURN 0; END IF;
  SELECT hash INTO STRICT anchor FROM ugv_trajectory_history_reception
    WHERE stream_id=s.stream_id AND sequence=p_through;
  PERFORM set_config('smpp.history_owner_prune','on',true);
  UPDATE ugv_trajectory_history_stream SET pruned_through=p_through,pruned_head_hash=anchor WHERE stream_id=s.stream_id;
  DELETE FROM ugv_trajectory_history_reception WHERE stream_id=s.stream_id AND sequence<=p_through;
  GET DIAGNOSTICS removed=ROW_COUNT;
  DELETE FROM ugv_trajectory_history_snapshot WHERE stream_id=s.stream_id AND expires_at<clock_timestamp();
  PERFORM set_config('smpp.history_owner_prune','off',true);
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION ugv_trajectory_history_prune(text,bigint) FROM PUBLIC;
