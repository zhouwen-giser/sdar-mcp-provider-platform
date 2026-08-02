ALTER TABLE provider_task
  DROP CONSTRAINT provider_task_substate_check,
  ADD CONSTRAINT provider_task_substate_check CHECK (
    substate IN ('accepted', 'scheduled', 'queued', 'running', 'paused', 'resuming', 'stopping')
  );
