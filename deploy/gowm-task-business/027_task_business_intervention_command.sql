-- SMPP owner deployment overlay for the fixed GOWM shared Runtime.
-- Optional business adjustments use the existing durable Task command lane.
-- The public caller's commandId is the retry identity; the request hash also
-- includes it so two distinct commands with identical values remain distinct.
ALTER TABLE ugv_smpp.task_command
  DROP CONSTRAINT task_command_command_type_check;

ALTER TABLE ugv_smpp.task_command
  ADD CONSTRAINT task_command_command_type_check CHECK (
    command_type IN ('CANCEL', 'UPDATE', 'PAUSE', 'RESUME', 'INTERVENTION')
  ),
  ADD CONSTRAINT task_command_intervention_payload_check CHECK (
    command_type <> 'INTERVENTION' OR (
      coalesce(jsonb_typeof(payload->'commandId') = 'string', false) AND
      coalesce(length(payload->>'commandId') BETWEEN 1 AND 256, false) AND
      coalesce((payload->>'semanticHash') ~ '^[0-9a-f]{64}$', false) AND
      coalesce(jsonb_typeof(payload->'command') = 'object', false)
    )
  );

CREATE UNIQUE INDEX task_command_intervention_id_idx
  ON ugv_smpp.task_command (device_id, task_id, (payload->>'commandId'))
  WHERE command_type = 'INTERVENTION';
