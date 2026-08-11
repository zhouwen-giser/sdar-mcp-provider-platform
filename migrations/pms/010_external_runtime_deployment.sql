ALTER TABLE runtime_deployment
  ADD COLUMN IF NOT EXISTS runtime_authority text NOT NULL DEFAULT 'platform_managed',
  ADD COLUMN IF NOT EXISTS direct_instance_id text,
  ADD COLUMN IF NOT EXISTS direct_control_endpoint text,
  ADD COLUMN IF NOT EXISTS direct_advertised_endpoint text;

ALTER TABLE runtime_deployment
  ALTER COLUMN database_profile_id DROP NOT NULL,
  ALTER COLUMN config_profile_id DROP NOT NULL;

ALTER TABLE runtime_deployment
  DROP CONSTRAINT IF EXISTS runtime_deployment_runtime_authority_check,
  DROP CONSTRAINT IF EXISTS runtime_deployment_authority_spec_check;

ALTER TABLE runtime_deployment
  ADD CONSTRAINT runtime_deployment_runtime_authority_check
  CHECK (runtime_authority IN ('platform_managed', 'direct_container')),
  ADD CONSTRAINT runtime_deployment_authority_spec_check
  CHECK (
    (
      runtime_authority = 'platform_managed'
      AND direct_instance_id IS NULL
      AND direct_control_endpoint IS NULL
      AND direct_advertised_endpoint IS NULL
      AND database_profile_id IS NOT NULL
      AND config_profile_id IS NOT NULL
    )
    OR
    (
      runtime_authority = 'direct_container'
      AND direct_instance_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
      AND direct_control_endpoint ~ '^https?://[^/?#]+/?$'
      AND direct_advertised_endpoint ~ '^https?://[^/?#]+/?$'
      AND adapter_endpoint IS NOT NULL
      AND database_profile_id IS NULL
      AND config_profile_id IS NULL
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS runtime_deployment_direct_instance_idx
  ON runtime_deployment (direct_instance_id)
  WHERE direct_instance_id IS NOT NULL;

ALTER TABLE runtime_process
  ADD COLUMN IF NOT EXISTS process_manager text NOT NULL DEFAULT 'pm2',
  ADD COLUMN IF NOT EXISTS control_endpoint text,
  ADD COLUMN IF NOT EXISTS advertised_endpoint text;

ALTER TABLE runtime_process
  ALTER COLUMN pm2_name DROP NOT NULL,
  ALTER COLUMN port DROP NOT NULL;

ALTER TABLE runtime_process
  DROP CONSTRAINT IF EXISTS runtime_process_config_state_check;

ALTER TABLE runtime_process
  ADD CONSTRAINT runtime_process_config_state_check
  CHECK (
    config_state IN (
      'unknown', 'current', 'externally_managed', 'stale', 'rejected', 'restart_required'
    )
  );

ALTER TABLE runtime_process
  DROP CONSTRAINT IF EXISTS runtime_process_process_manager_check,
  DROP CONSTRAINT IF EXISTS runtime_process_authority_identity_check;

ALTER TABLE runtime_process
  ADD CONSTRAINT runtime_process_process_manager_check
  CHECK (process_manager IN ('pm2', 'direct_container')),
  ADD CONSTRAINT runtime_process_authority_identity_check
  CHECK (
    (
      process_manager = 'pm2'
      AND pm2_name IS NOT NULL
      AND port IS NOT NULL
      AND control_endpoint IS NULL
      AND advertised_endpoint IS NULL
    )
    OR
    (
      process_manager = 'direct_container'
      AND pm2_name IS NULL
      AND port IS NULL
      AND control_endpoint ~ '^https?://[^/?#]+/?$'
      AND advertised_endpoint ~ '^https?://[^/?#]+/?$'
    )
  );

CREATE INDEX IF NOT EXISTS runtime_process_manager_state_idx
  ON runtime_process (process_manager, process_state, readiness_state);
