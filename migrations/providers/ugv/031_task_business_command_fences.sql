-- Unique semantic entry and Runtime command-sequence claims within a bound scope.
-- Failed commands release the semantic entry, but never reuse Runtime sequence.
CREATE UNIQUE INDEX IF NOT EXISTS ugv_task_business_command_entry_fence_idx
  ON ugv_task_business_command(scope_hash, (payload->>'entryKey'))
  WHERE state IN ('accepted', 'applied') AND payload ? 'entryKey';

CREATE UNIQUE INDEX IF NOT EXISTS ugv_task_business_command_runtime_sequence_idx
  ON ugv_task_business_command(scope_hash, command_type, (payload->>'runtimeCommandSequence'))
  WHERE payload ? 'runtimeCommandSequence';
