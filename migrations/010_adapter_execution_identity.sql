CREATE UNIQUE INDEX provider_task_external_execution_identity_unique
  ON provider_task (provider_id, external_execution_id)
  WHERE external_execution_id IS NOT NULL;
