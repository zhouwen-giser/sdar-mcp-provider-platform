CREATE SEQUENCE IF NOT EXISTS ugv_diagnostic_fence_seq AS bigint;

CREATE TABLE IF NOT EXISTS ugv_diagnostic_lease (
  lease_id uuid PRIMARY KEY,
  capability_id text NOT NULL,
  stable_operation_key text UNIQUE NOT NULL CHECK (stable_operation_key ~ '^[0-9a-f]{64}$'),
  canonical_request_hash text NOT NULL CHECK (canonical_request_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL,
  fence bigint UNIQUE NOT NULL DEFAULT nextval('ugv_diagnostic_fence_seq'),
  state text NOT NULL CHECK (state IN ('ARMED','BOUND','CONSUMED','DISARMED','EXPIRED')),
  logical_invocation_id text NOT NULL,
  scoped_task_id text,
  bound_task_id text,
  external_execution_id text,
  device_mission_id text,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS ugv_diagnostic_lease_match_idx
  ON ugv_diagnostic_lease(capability_id, logical_invocation_id, state, fence);
CREATE INDEX IF NOT EXISTS ugv_diagnostic_lease_expiry_idx
  ON ugv_diagnostic_lease(expires_at) WHERE state IN ('ARMED','BOUND');

CREATE TABLE IF NOT EXISTS ugv_diagnostic_receipt (
  receipt_id uuid PRIMARY KEY,
  lease_id uuid NOT NULL REFERENCES ugv_diagnostic_lease(lease_id),
  action text NOT NULL CHECK (action IN ('armed','bound','consumed','disarmed','expired')),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  UNIQUE(lease_id, action)
);

CREATE OR REPLACE FUNCTION reject_ugv_diagnostic_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lease_id <> OLD.lease_id
     OR NEW.capability_id <> OLD.capability_id
     OR NEW.stable_operation_key <> OLD.stable_operation_key
     OR NEW.canonical_request_hash <> OLD.canonical_request_hash
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.fence <> OLD.fence
     OR NEW.logical_invocation_id <> OLD.logical_invocation_id
     OR NEW.scoped_task_id IS DISTINCT FROM OLD.scoped_task_id
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'UGV_DIAGNOSTIC_IDENTITY_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ugv_diagnostic_identity_immutable ON ugv_diagnostic_lease;
CREATE TRIGGER ugv_diagnostic_identity_immutable
BEFORE UPDATE ON ugv_diagnostic_lease
FOR EACH ROW EXECUTE FUNCTION reject_ugv_diagnostic_identity_mutation();

CREATE OR REPLACE FUNCTION reject_ugv_diagnostic_receipt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'UGV_DIAGNOSTIC_RECEIPT_APPEND_ONLY' USING ERRCODE='55000';
END;
$$;

DROP TRIGGER IF EXISTS ugv_diagnostic_receipt_append_only ON ugv_diagnostic_receipt;
CREATE TRIGGER ugv_diagnostic_receipt_append_only
BEFORE UPDATE OR DELETE ON ugv_diagnostic_receipt
FOR EACH ROW EXECUTE FUNCTION reject_ugv_diagnostic_receipt_mutation();
