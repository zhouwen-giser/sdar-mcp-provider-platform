ALTER TABLE admission_intent
  ADD COLUMN reservation_ref text,
  ADD CONSTRAINT admission_intent_reservation_ref_length
    CHECK (reservation_ref IS NULL OR length(reservation_ref) BETWEEN 1 AND 256);

ALTER TABLE provider_task
  ADD COLUMN reservation_ref text,
  ADD CONSTRAINT provider_task_reservation_ref_length
    CHECK (reservation_ref IS NULL OR length(reservation_ref) BETWEEN 1 AND 256);
