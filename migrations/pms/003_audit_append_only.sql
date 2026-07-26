CREATE OR REPLACE FUNCTION pms_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'PMS_AUDIT_APPEND_ONLY'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS audit_append_only_guard ON audit;

CREATE TRIGGER audit_append_only_guard
BEFORE UPDATE OR DELETE ON audit
FOR EACH ROW
EXECUTE FUNCTION pms_reject_audit_mutation();
