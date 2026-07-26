ALTER TABLE provider_task
  ADD COLUMN runtime_revision bigint NOT NULL DEFAULT 1 CHECK (runtime_revision > 0),
  ADD COLUMN runtime_updated_at timestamptz NOT NULL DEFAULT clock_timestamp();

UPDATE provider_task
SET runtime_updated_at = updated_at;

