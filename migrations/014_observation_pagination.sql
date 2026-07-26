CREATE INDEX task_observation_task_revision_desc_idx
  ON task_observation (task_id, revision DESC);
