ALTER TABLE admission_intent
  ADD COLUMN trace_id char(32),
  ADD COLUMN root_traceparent text,
  ADD COLUMN root_tracestate text,
  ADD COLUMN correlation_id text;

ALTER TABLE provider_task
  ADD COLUMN trace_id char(32),
  ADD COLUMN root_traceparent text,
  ADD COLUMN root_tracestate text,
  ADD COLUMN correlation_id text;

ALTER TABLE admission_intent
  ADD CONSTRAINT admission_intent_trace_id_format
    CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT admission_intent_traceparent_format
    CHECK (root_traceparent IS NULL OR root_traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');

ALTER TABLE provider_task
  ADD CONSTRAINT provider_task_trace_id_format
    CHECK (trace_id IS NULL OR trace_id ~ '^[0-9a-f]{32}$'),
  ADD CONSTRAINT provider_task_traceparent_format
    CHECK (root_traceparent IS NULL OR root_traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');
