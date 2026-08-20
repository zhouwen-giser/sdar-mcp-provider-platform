# LIVE Retest Runbook

This runbook is for a separately authorized maintenance window. It was not executed by this Goal.

1. Build and deploy the commit containing this fix.
2. Confirm Runtime, Adapter, MQTT and Device MCP readiness using read-only probes.
3. Confirm the target vehicle and route are safe for movement.
4. Use a newly generated idempotency key for exactly one `vehicle_navigate` call.
5. Observe Execution persistence, both accepted journal entries, the returned mission ID and physical telemetry.
6. Do not retry automatically if the outcome is uncertain.

The following old idempotency key is permanently forbidden for reuse:

```text
ugv-nav-20260818-10681344630
```
