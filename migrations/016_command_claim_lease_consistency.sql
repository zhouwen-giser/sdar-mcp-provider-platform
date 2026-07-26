ALTER TABLE task_command
  ADD CONSTRAINT task_command_claim_lease_consistency CHECK (
    (state = 'CLAIMED' AND claim_owner IS NOT NULL AND claim_until IS NOT NULL)
    OR
    (state <> 'CLAIMED' AND claim_owner IS NULL AND claim_until IS NULL)
  );
