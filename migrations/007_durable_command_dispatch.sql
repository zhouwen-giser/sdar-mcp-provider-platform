ALTER TABLE task_command
  DROP CONSTRAINT task_command_state_check;

ALTER TABLE task_command
  DROP CONSTRAINT task_command_task_id_command_type_request_hash_key;

ALTER TABLE task_command
  ADD CONSTRAINT task_command_state_check CHECK (state IN (
    'PENDING', 'CLAIMED', 'RETRY_WAIT', 'ACKNOWLEDGED', 'REJECTED', 'EXHAUSTED'
  )),
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ADD COLUMN claim_owner text,
  ADD COLUMN claim_until timestamptz,
  ADD COLUMN last_error_code text,
  ADD COLUMN last_error_message text,
  ADD COLUMN priority integer NOT NULL DEFAULT 0,
  ADD COLUMN stop_reason text,
  ADD COLUMN previous_internal_state text,
  ADD COLUMN previous_mcp_status text,
  ADD COLUMN previous_substate text,
  ADD COLUMN previous_status_message text;

UPDATE task_command
SET stop_reason = payload->>'reason',
    priority = CASE WHEN payload->>'reason' IN ('DEADLINE_REACHED', 'START_WINDOW_MISSED')
      THEN 100 ELSE 10 END
WHERE command_type = 'CANCEL';

DROP INDEX task_command_pending_idx;

CREATE INDEX task_command_dispatch_due_idx
  ON task_command (priority DESC, next_attempt_at, created_at, task_id, command_sequence)
  WHERE command_type = 'CANCEL'
    AND state IN ('PENDING', 'RETRY_WAIT', 'CLAIMED');

CREATE UNIQUE INDEX task_command_active_stop_idx
  ON task_command (task_id)
  WHERE command_type = 'CANCEL'
    AND state IN ('PENDING', 'CLAIMED', 'RETRY_WAIT', 'ACKNOWLEDGED');

CREATE UNIQUE INDEX task_command_non_cancel_request_idx
  ON task_command (task_id, command_type, request_hash)
  WHERE command_type <> 'CANCEL';
