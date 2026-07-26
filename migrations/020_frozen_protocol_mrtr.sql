ALTER TABLE task_input_request
  ADD COLUMN request_json jsonb,
  ADD COLUMN response_hash char(64),
  ADD COLUMN response_json jsonb;

UPDATE task_input_request
SET request_json = jsonb_build_object(
      'method', 'elicitation/create',
      'params', jsonb_build_object(
        'mode', 'form',
        'message', description,
        'requestedSchema', schema
      )
    ),
    response_hash = CASE
      WHEN status = 'ANSWERED' AND answer_hash IS NOT NULL THEN answer_hash
      ELSE NULL
    END,
    response_json = CASE
      WHEN status = 'ANSWERED' AND answer_hash IS NOT NULL
        THEN jsonb_build_object('action', 'accept', 'content', answer)
      ELSE NULL
    END;

ALTER TABLE task_input_request
  ALTER COLUMN request_json SET NOT NULL,
  ADD CONSTRAINT task_input_request_request_json_object
    CHECK (jsonb_typeof(request_json) = 'object'),
  ADD CONSTRAINT task_input_request_response_json_object
    CHECK (response_json IS NULL OR jsonb_typeof(response_json) = 'object'),
  ADD CONSTRAINT task_input_request_response_pair
    CHECK ((response_hash IS NULL) = (response_json IS NULL));
