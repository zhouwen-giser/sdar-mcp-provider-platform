ALTER TABLE ugv_diagnostic_lease
  ALTER COLUMN logical_invocation_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS selector_argument_hash text;

ALTER TABLE ugv_diagnostic_lease
  DROP CONSTRAINT IF EXISTS ugv_diagnostic_selector_argument_hash_valid;
ALTER TABLE ugv_diagnostic_lease
  ADD CONSTRAINT ugv_diagnostic_selector_argument_hash_valid
  CHECK (selector_argument_hash IS NULL OR selector_argument_hash ~ '^[0-9a-f]{64}$');

DROP INDEX IF EXISTS ugv_diagnostic_lease_match_idx;
CREATE INDEX IF NOT EXISTS ugv_diagnostic_lease_selector_match_idx
  ON ugv_diagnostic_lease(selector_argument_hash, capability_id, state, fence)
  WHERE selector_argument_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION reject_ugv_diagnostic_identity_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.lease_id <> OLD.lease_id
     OR NEW.capability_id <> OLD.capability_id
     OR NEW.stable_operation_key <> OLD.stable_operation_key
     OR NEW.canonical_request_hash <> OLD.canonical_request_hash
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.fence <> OLD.fence
     OR NEW.selector_argument_hash IS DISTINCT FROM OLD.selector_argument_hash
     OR (OLD.logical_invocation_id IS NOT NULL
         AND NEW.logical_invocation_id IS DISTINCT FROM OLD.logical_invocation_id)
     OR NEW.scoped_task_id IS DISTINCT FROM OLD.scoped_task_id
     OR (OLD.bound_task_id IS NOT NULL AND NEW.bound_task_id IS DISTINCT FROM OLD.bound_task_id)
     OR (OLD.external_execution_id IS NOT NULL
         AND NEW.external_execution_id IS DISTINCT FROM OLD.external_execution_id)
     OR (OLD.device_mission_id IS NOT NULL
         AND NEW.device_mission_id IS DISTINCT FROM OLD.device_mission_id)
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
