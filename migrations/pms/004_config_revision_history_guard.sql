CREATE OR REPLACE FUNCTION pms_reject_config_revision_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'PMS_CONFIG_REVISION_DELETE_FORBIDDEN'
      USING ERRCODE = '55000';
  END IF;

  IF NEW.revision_id IS DISTINCT FROM OLD.revision_id
     OR NEW.definition_id IS DISTINCT FROM OLD.definition_id
     OR NEW.revision IS DISTINCT FROM OLD.revision
     OR NEW.checksum IS DISTINCT FROM OLD.checksum
     OR NEW.apply_mode IS DISTINCT FROM OLD.apply_mode
     OR NEW.content IS DISTINCT FROM OLD.content
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'PMS_CONFIG_REVISION_PAYLOAD_IMMUTABLE'
      USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('validated', 'rejected'))
    OR (OLD.status = 'validated' AND NEW.status IN ('published', 'rejected'))
    OR (OLD.status = 'published' AND NEW.status = 'superseded')
  ) THEN
    RAISE EXCEPTION 'PMS_CONFIG_REVISION_TRANSITION_FORBIDDEN'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS config_revision_history_guard ON config_revision;

CREATE TRIGGER config_revision_history_guard
BEFORE UPDATE OR DELETE ON config_revision
FOR EACH ROW
EXECUTE FUNCTION pms_reject_config_revision_history_mutation();
