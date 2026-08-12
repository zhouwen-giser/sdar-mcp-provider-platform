-- A physical UGV weapon must have at most one non-terminal fire execution,
-- including across adapter replicas and process restarts. Emergency-stop rows
-- are intentionally excluded so that safety preemption remains available.
CREATE UNIQUE INDEX IF NOT EXISTS ugv_single_active_fire_execution
  ON ugv_execution (resource_id)
  WHERE operation_name = 'vehicle_fire_weapon'
    AND state NOT IN ('SUCCEEDED', 'BUSINESS_FAILED', 'CANCELLED', 'TECHNICAL_FAILED');
