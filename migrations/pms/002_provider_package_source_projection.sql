ALTER TABLE provider_type
  DROP CONSTRAINT IF EXISTS provider_type_provider_type_id_check;

ALTER TABLE provider_type
  ADD CONSTRAINT provider_type_provider_type_id_check
  CHECK (provider_type_id ~ '^[a-z][a-z0-9_-]*(?:\.[a-z0-9_-]+)+$');

ALTER TABLE provider_package
  ADD COLUMN IF NOT EXISTS source_document jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE provider_package
  DROP CONSTRAINT IF EXISTS provider_package_source_document_check;

ALTER TABLE provider_package
  ADD CONSTRAINT provider_package_source_document_check
  CHECK (jsonb_typeof(source_document) = 'object');
