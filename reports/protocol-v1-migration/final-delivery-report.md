# Frozen SDAR MCP Tasks Protocol V1 Runtime Delivery Report

## Outcome

The Runtime migration to the frozen SDAR MCP Tasks Unified Protocol Profile V1.0 is implemented and
passes the exact-commit V2 gate. The Runtime target is `2.0.0-rc.1`; Legacy and frozen handlers are
isolated, and Legacy access is opt-in only.

The repository may claim **Component Conformant** only. It must not claim Interop Certified.

## Immutable inputs

- Frozen contract SHA-256: `d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`
- MCP protocol version: `2026-07-28`
- MCP source commit: `26897cc322f356487da89113451bd16b520b9288`
- MCP schema Git blob: `cc44564e33305dbc07e820cdd0a97648f3852019`
- MCP schema SHA-256: `9281c4890630e2d1e61792fa23b4084c4ea360cd58519610cd050545ab7b8708`
- Evidence binding: `type_only`

## Delivered scope

- SEP-2663 request routing, negotiation headers, discovery and Tool profile enforcement.
- Flat task results, authoritative detailed projection, true TTL and monotonic Runtime revision.
- Durable keyed MRTR, reservation identity and cooperative cancellation.
- Type-only Evidence validation and projection without `requirementId`.
- Authorization-filtered durable SSE notifications with backpressure and cancellation behavior.
- Explicit Legacy isolation at `/mcp/legacy` behind `MCP_LEGACY_ENDPOINT_ENABLED=true`.
- Additive Adapter protocol support in both TypeScript and Python examples.
- Numbered C-001 through C-074 machine conformance with real PostgreSQL lifecycle coverage.
- Required `MCP_LEGACY_ENDPOINT_ENABLED` configuration across Runtime and deployment surfaces.
- Real two-HTTP-replica SSE C-055 coverage against a shared PostgreSQL task authority.
- Separate Runtime, TypeScript Adapter and Python Adapter component reports under
  `reports/protocol-v1-conformance/`.
- V2 CI, dependency/SBOM/deployment/image checks and frozen-protocol capacity baseline.

## Verification

Exact implementation commit `78fae03` was checked out in a detached worktree and verified against a
disposable PostgreSQL database. `pnpm verify:v2` completed with exit code 0 in 487.1 seconds on
2026-07-18. The frozen catalog passed 74/74 and every constituent gate passed. Detailed counts and
the shutdown-order warning are recorded in `reports/protocol-v1-migration/test-matrix.md`.

This report is a documentation-only follow-up to the audited implementation commit. Publication CI
must still verify the report commit; this report does not relabel the exact-commit audit as a future
PR check.

## Publication boundary

Runtime implementation is ready for a Draft PR and protected CI. No merge or release tag has been
performed by this report. Normal merge is required; force-push and protected-flow bypasses remain
forbidden.

Provider branches, including the requested Home Assistant light and air-conditioner Providers, must
not change their wire contract until the Runtime PR merges to `main`. After that merge, each active
Provider branch must merge the new `origin/main`, rerun Provider conformance and prove Runtime E2E.

## Known observation

The capacity runner can log a deferred Provider telemetry delivery after its PostgreSQL pool closes.
This occurs after the complete capacity report, did not fail the command, and does not invalidate the
measured workloads. It remains a cleanup-order improvement candidate rather than a frozen-protocol
conformance blocker.
