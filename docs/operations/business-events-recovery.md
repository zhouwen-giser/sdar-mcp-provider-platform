# Business Events Recovery and PITR Runbook

Business Events use PostgreSQL as the sole durable authority. After a point-in-time restore (PITR), do not let a Runtime silently continue an Adapter cursor from the restored generation: explicitly rotate the stream before restoring traffic.

## Recovery procedure

1. Keep `BUSINESS_EVENTS_ENABLED=false` or remove the Runtime from traffic while PostgreSQL is restored.
2. Verify migrations through `023_business_events_profile_v1.sql`, the Provider identity, current generation, frozen source roster, and each source stream identity.
3. Start the Adapter and verify `DescribeProvider` returns the expected source roster. Do not reuse a durable source stream identity when its retained cursor no longer covers the Runtime cursor.
4. Run `pnpm business-events:rotate -- --provider-id <provider> --reason-code OPERATOR_PITR --idempotency-key <restore-id>`. Repeating the same key is safe and returns the same rotation outcome.
5. Confirm the old generation is `replayable_closed`, the new generation is `current`, and the continuity record contains the affected sources and last replayable sequence.
6. Enable Business Events, verify all `businessEvent*` readiness entries and the bounded source metrics, then restore traffic.

The operator rotation is an explicit recovery boundary; the Runtime does not claim automatic PITR detection. Never edit source cursors, fencing tokens, generations, events, or projection tokens manually. If source identity or retention cannot be proven, keep ingestion degraded and rotate with the affected source IDs rather than claiming gap-free continuity.
