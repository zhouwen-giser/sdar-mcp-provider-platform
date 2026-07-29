CREATE TABLE IF NOT EXISTS database_profile (
  profile_id text PRIMARY KEY
    CHECK (profile_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  provider_id text NOT NULL REFERENCES provider(provider_id),
  environment text NOT NULL CHECK (environment ~ '^[a-z][a-z0-9-]{0,62}$'),
  cluster_ref text NOT NULL
    CHECK (cluster_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  host text NOT NULL
    CHECK (
      char_length(host) BETWEEN 1 AND 253
      AND host ~ '^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$'
      AND position('..' IN host) = 0
    ),
  port integer NOT NULL CHECK (port BETWEEN 1 AND 65535),
  database_mode text NOT NULL CHECK (database_mode IN ('provisioned', 'preexisting')),
  database_name text NOT NULL UNIQUE
    CHECK (database_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  runtime_role_name text NOT NULL UNIQUE
    CHECK (runtime_role_name ~ '^[a-z][a-z0-9_]{0,62}$'),
  ssl_mode text NOT NULL CHECK (ssl_mode IN ('disable', 'require', 'verify-ca', 'verify-full')),
  admin_secret_ref text NOT NULL
    CHECK (admin_secret_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  runtime_secret_ref text NOT NULL
    CHECK (runtime_secret_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$'),
  provision_status text NOT NULL DEFAULT 'pending'
    CHECK (provision_status IN ('pending', 'provisioning', 'ready', 'failed')),
  last_error_code text
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  provisioned_at timestamptz,
  created_audit_event_id uuid NOT NULL REFERENCES audit(audit_event_id),
  last_audit_event_id uuid NOT NULL REFERENCES audit(audit_event_id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (provider_id, environment),
  CHECK (admin_secret_ref <> runtime_secret_ref),
  CHECK (
    (provision_status = 'failed' AND last_error_code IS NOT NULL)
    OR
    (provision_status <> 'failed' AND last_error_code IS NULL)
  ),
  CHECK (
    (provision_status = 'ready' AND provisioned_at IS NOT NULL)
    OR
    (provision_status <> 'ready' AND provisioned_at IS NULL)
  ),
  CHECK (updated_at >= created_at)
);

CREATE INDEX IF NOT EXISTS database_profile_provider_status_idx
  ON database_profile (provider_id, environment, provision_status);

CREATE INDEX IF NOT EXISTS database_profile_audit_idx
  ON database_profile (last_audit_event_id);
