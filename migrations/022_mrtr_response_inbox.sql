ALTER TABLE task_input_request
  DROP CONSTRAINT task_input_request_status_check,
  ADD CONSTRAINT task_input_request_status_check
    CHECK (status IN ('OPEN', 'ANSWERED', 'SUPERSEDED'));

CREATE TABLE task_input_response_inbox (
  task_id              uuid        NOT NULL,
  request_key          text        NOT NULL,
  response_hash        text        NOT NULL,
  response_json        jsonb       NOT NULL,

  state                 text        NOT NULL,
  command_sequence      bigint      NULL,

  accepted_at           timestamptz NOT NULL DEFAULT clock_timestamp(),
  assigned_at           timestamptz NULL,
  acknowledged_at       timestamptz NULL,
  failed_at             timestamptz NULL,

  last_error_code       text        NULL,
  last_error_message    text        NULL,
  updated_at             timestamptz NOT NULL DEFAULT clock_timestamp(),

  PRIMARY KEY (task_id, request_key),

  FOREIGN KEY (task_id, request_key)
    REFERENCES task_input_request(task_id, request_key),

  CHECK (state IN (
    'PENDING',
    'ASSIGNED',
    'ACKNOWLEDGED',
    'IGNORED',
    'FAILED'
  ))
);

CREATE INDEX task_input_response_inbox_pending_idx
ON task_input_response_inbox(state, accepted_at, task_id)
WHERE state = 'PENDING';
