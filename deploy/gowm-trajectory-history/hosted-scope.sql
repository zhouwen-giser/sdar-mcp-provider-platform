ALTER TABLE ugv_smpp.ugv_trajectory_history_stream ADD COLUMN device_id text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream ALTER COLUMN device_id SET DEFAULT current_setting('smpp.device_id');
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream
  ADD COLUMN gowm_binding_id uuid NOT NULL REFERENCES gowm_device.device_service_binding(binding_id),
  ADD COLUMN smpp_service_key text NOT NULL,
  ADD COLUMN source_session_key text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream
  ALTER COLUMN gowm_binding_id SET DEFAULT current_setting('smpp.binding_id')::uuid,
  ALTER COLUMN smpp_service_key SET DEFAULT current_setting('smpp.service_key'),
  ALTER COLUMN source_session_key SET DEFAULT current_setting('smpp.source_session_key');
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream FORCE ROW LEVEL SECURITY;
CREATE POLICY smpp_trajectory_scope ON ugv_smpp.ugv_trajectory_history_stream
  USING (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key')) WITH CHECK (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key'));
ALTER TABLE ugv_smpp.ugv_trajectory_history_session ADD COLUMN device_id text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_session ALTER COLUMN device_id SET DEFAULT current_setting('smpp.device_id');
ALTER TABLE ugv_smpp.ugv_trajectory_history_session
  ADD COLUMN gowm_binding_id uuid NOT NULL REFERENCES gowm_device.device_service_binding(binding_id),
  ADD COLUMN smpp_service_key text NOT NULL,
  ADD COLUMN source_session_key text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_session
  ALTER COLUMN gowm_binding_id SET DEFAULT current_setting('smpp.binding_id')::uuid,
  ALTER COLUMN smpp_service_key SET DEFAULT current_setting('smpp.service_key'),
  ALTER COLUMN source_session_key SET DEFAULT current_setting('smpp.source_session_key');
ALTER TABLE ugv_smpp.ugv_trajectory_history_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugv_smpp.ugv_trajectory_history_session FORCE ROW LEVEL SECURITY;
CREATE POLICY smpp_trajectory_scope ON ugv_smpp.ugv_trajectory_history_session
  USING (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_session.stream_id)) WITH CHECK (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_session.stream_id));
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception ADD COLUMN device_id text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception ALTER COLUMN device_id SET DEFAULT current_setting('smpp.device_id');
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception
  ADD COLUMN gowm_binding_id uuid NOT NULL REFERENCES gowm_device.device_service_binding(binding_id),
  ADD COLUMN smpp_service_key text NOT NULL,
  ADD COLUMN source_session_key text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception
  ALTER COLUMN gowm_binding_id SET DEFAULT current_setting('smpp.binding_id')::uuid,
  ALTER COLUMN smpp_service_key SET DEFAULT current_setting('smpp.service_key'),
  ALTER COLUMN source_session_key SET DEFAULT current_setting('smpp.source_session_key');
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugv_smpp.ugv_trajectory_history_reception FORCE ROW LEVEL SECURITY;
CREATE POLICY smpp_trajectory_scope ON ugv_smpp.ugv_trajectory_history_reception
  USING (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_reception.stream_id)) WITH CHECK (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_reception.stream_id));
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot ADD COLUMN device_id text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot ALTER COLUMN device_id SET DEFAULT current_setting('smpp.device_id');
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot
  ADD COLUMN gowm_binding_id uuid NOT NULL REFERENCES gowm_device.device_service_binding(binding_id),
  ADD COLUMN smpp_service_key text NOT NULL,
  ADD COLUMN source_session_key text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot
  ALTER COLUMN gowm_binding_id SET DEFAULT current_setting('smpp.binding_id')::uuid,
  ALTER COLUMN smpp_service_key SET DEFAULT current_setting('smpp.service_key'),
  ALTER COLUMN source_session_key SET DEFAULT current_setting('smpp.source_session_key');
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugv_smpp.ugv_trajectory_history_snapshot FORCE ROW LEVEL SECURITY;
CREATE POLICY smpp_trajectory_scope ON ugv_smpp.ugv_trajectory_history_snapshot
  USING (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_snapshot.stream_id)) WITH CHECK (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key') AND EXISTS(SELECT 1 FROM ugv_smpp.ugv_trajectory_history_stream s WHERE s.stream_id=ugv_trajectory_history_snapshot.stream_id));
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence ALTER COLUMN device_id SET DEFAULT current_setting('smpp.device_id');
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence ALTER COLUMN device_id SET NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence
  ADD COLUMN gowm_binding_id uuid NOT NULL REFERENCES gowm_device.device_service_binding(binding_id),
  ADD COLUMN smpp_service_key text NOT NULL,
  ADD COLUMN source_session_key text NOT NULL;
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence
  ALTER COLUMN gowm_binding_id SET DEFAULT current_setting('smpp.binding_id')::uuid,
  ALTER COLUMN smpp_service_key SET DEFAULT current_setting('smpp.service_key'),
  ALTER COLUMN source_session_key SET DEFAULT current_setting('smpp.source_session_key');
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE ugv_smpp.ugv_trajectory_projection_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY smpp_trajectory_scope ON ugv_smpp.ugv_trajectory_projection_evidence
  USING (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key')) WITH CHECK (device_id=current_setting('smpp.device_id') AND gowm_binding_id=current_setting('smpp.binding_id')::uuid AND smpp_service_key=current_setting('smpp.service_key') AND source_session_key=current_setting('smpp.source_session_key'));
ALTER TABLE ugv_smpp.ugv_trajectory_history_stream ADD CONSTRAINT ugv_trajectory_stream_payload_scope CHECK (
  scope_payload->>'deviceId'=device_id AND scope_payload->>'bindingId'=gowm_binding_id::text
  AND scope_payload->>'smppServiceKey'=smpp_service_key AND scope_payload->>'sourceSessionKey'=source_session_key
  AND scope_payload->>'deviceIdentityAuthority'='GOWM_DEVICE_BINDING');
CREATE OR REPLACE FUNCTION ugv_smpp.ugv_trajectory_hosted_scope_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.device_id IS DISTINCT FROM OLD.device_id OR NEW.gowm_binding_id IS DISTINCT FROM OLD.gowm_binding_id
    OR NEW.smpp_service_key IS DISTINCT FROM OLD.smpp_service_key OR NEW.source_session_key IS DISTINCT FROM OLD.source_session_key THEN
    RAISE EXCEPTION 'TRAJECTORY_HISTORY_SCOPE_IMMUTABLE' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER ugv_trajectory_hosted_scope_immutable BEFORE UPDATE ON ugv_smpp.ugv_trajectory_history_stream
FOR EACH ROW EXECUTE FUNCTION ugv_smpp.ugv_trajectory_hosted_scope_immutable();
CREATE TRIGGER ugv_trajectory_hosted_scope_immutable BEFORE UPDATE ON ugv_smpp.ugv_trajectory_history_session
FOR EACH ROW EXECUTE FUNCTION ugv_smpp.ugv_trajectory_hosted_scope_immutable();
REVOKE ALL ON ugv_smpp.ugv_trajectory_history_stream,ugv_smpp.ugv_trajectory_history_session,ugv_smpp.ugv_trajectory_history_reception,ugv_smpp.ugv_trajectory_history_snapshot,ugv_smpp.ugv_trajectory_projection_evidence FROM ugv_smpp_app;
GRANT SELECT,INSERT,UPDATE ON ugv_smpp.ugv_trajectory_history_stream,ugv_smpp.ugv_trajectory_history_session TO ugv_smpp_app;
GRANT SELECT,INSERT ON ugv_smpp.ugv_trajectory_history_reception,ugv_smpp.ugv_trajectory_history_snapshot,ugv_smpp.ugv_trajectory_projection_evidence TO ugv_smpp_app;
REVOKE ALL ON FUNCTION ugv_smpp.ugv_trajectory_history_prune(text,bigint) FROM ugv_smpp_app,PUBLIC;
