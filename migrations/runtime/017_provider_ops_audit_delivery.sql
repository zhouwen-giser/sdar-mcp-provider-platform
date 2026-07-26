CREATE TABLE provider_ops_delivery (
  record_id uuid PRIMARY KEY,
  event_key text NOT NULL UNIQUE,
  record_type text NOT NULL,
  event_category text NOT NULL,
  delivery_class text NOT NULL CHECK (delivery_class IN ('audit','operational')),
  aggregate_type text NOT NULL CHECK (aggregate_type IN ('task','command','provider','scheduler','recovery','ttl')),
  aggregate_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  record_body jsonb NOT NULL CHECK (jsonb_typeof(record_body) = 'object'),
  state text NOT NULL DEFAULT 'PENDING'
    CHECK (state IN ('PENDING','CLAIMED','RETRY_WAIT','DELIVERED','EXHAUSTED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claim_owner text,
  claim_until timestamptz,
  last_error_code text,
  last_error_message text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (
    (state = 'CLAIMED' AND claim_owner IS NOT NULL AND claim_until IS NOT NULL)
    OR
    (state <> 'CLAIMED' AND claim_owner IS NULL AND claim_until IS NULL)
  )
);

CREATE INDEX provider_ops_delivery_due_idx
  ON provider_ops_delivery (next_attempt_at, created_at, record_id)
  WHERE state IN ('PENDING','RETRY_WAIT');

CREATE INDEX provider_ops_delivery_expired_claim_idx
  ON provider_ops_delivery (claim_until, record_id)
  WHERE state = 'CLAIMED';
