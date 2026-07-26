# UGV Provider V1 Work Delivery Report

## Outcome

The detached project implements the complete UGV Provider component for `vehicle:ugv1`: nine manifest operations, exact-topic MQTT ingress, an allowlisted Device MCP client, PostgreSQL execution and event persistence, long-running command semantics, recovery, Business Events, telemetry, mock infrastructure, Compose wiring, tests, and delivery automation.

The supported claim is **UGV Provider Component Complete against the supplied protocol and Mock Level 1 contract**. Real ISR interface conformance is not claimed because no real Device MCP endpoint, MQTT broker, credentials, or ISR simulation source tree was available.

## Verification

- Format, lint, TypeScript, build, detached generated-file check, and 10 protected-file hashes passed.
- UGV test suites: 9 unit, 4 contract, 6 integration, 3 security, and 1 gRPC E2E test passed (23 total).
- Existing non-database regression suites passed: 110 unit, 13 contract, 34 security, 71 frozen-protocol, 19 PR16 interop, 81 Business Events protocol, 5 Business Events adapter-contract, 15 telemetry unit, and 2 telemetry-security tests.
- The mock Device MCP served and listed 18 tools over Streamable HTTP MCP; the client called `ugv_laser_range` successfully.
- Full runtime E2E, frozen-74, runtime closure/follow-up, Business Events database suites, and HA Climate protocol-v1 could not run because `TEST_DATABASE_URL` and a PostgreSQL service were unavailable.
- Docker Compose config/up could not run because Docker is not installed in this execution environment. The profile is present in `compose.yaml` and in-process gRPC E2E passed.

## Safety and truth boundaries

The implementation uses only the twelve exact UGV MQTT topics and the eighteen explicit Device MCP tools. It rejects wildcard topics, oversized/ambiguous messages, identity mismatches, stale state, and unavailable required tools. Fire commands require confirmation and recursively strip hit/miss/destruction/damage/remaining-health/friendly-fire fields before any result, evidence, event, telemetry, or store boundary. A completed local weapon cycle never claims a hit.

The frozen adapter protocol has no `STARTING` or `UNCERTAIN` enum. Internal `STARTING` is exposed as `ACCEPTED`; uncertain recovery is exposed as `TRANSIENT_UNAVAILABLE` with reason code `UNCERTAIN_EXECUTION_STATE`. No frozen protocol file was changed.

## Provenance and limitations

The source was obtained as the repository's `main` archive and copied without Git metadata. No Git command or remote write was performed. The required interface document has the exact mandated SHA-256 after removing one terminal LF from the archive copy; the semantic text is unchanged and the normalization record is included.

The supplied protocol-profile document contains a task-package hash that does not match the supplied task-package bytes. Both actual hashes are locked and neither document was rewritten. Node 24.14.0 and pnpm 11.7.0 were available; the project declares Node `>=22 <23` and pnpm 11.13.1, so engine warnings were recorded even though all executed static and UGV gates passed.

See `external-interface-blocker.json`, `compose-e2e.json`, `final-delivery-summary.json`, and `work-checkpoints/U0.json` through `U9.json` for machine-readable evidence.
