-- Development bootstrap requires an empty task/admission store. An old Task's
-- owning instance cannot be reconstructed from the process applying migrations.
ALTER TABLE admission_intent
  ADD COLUMN provider_instance_id text NOT NULL
    CHECK (length(provider_instance_id) BETWEEN 1 AND 256);

ALTER TABLE provider_task
  ADD COLUMN provider_instance_id text NOT NULL
    CHECK (length(provider_instance_id) BETWEEN 1 AND 256);
