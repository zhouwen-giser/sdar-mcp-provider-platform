# Phase S5 Report — After-commit response-loss seam

## Source

- Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Parent phase: S4 `b4187ff`

## Changes

- Added a generic `DiagnosticAdapterGateway` around the Runtime→Adapter start boundary.
- Added a disabled-by-default, test-profile-only one-shot lease controller with TTL and audit trail.
- Suppression occurs only after the delegated Adapter call returns successfully.
- `TaskEngine` classifies the typed suppression as `response_lost_after_adapter_success`.
- Fire, weapon, shoot, missile and armament operations are never eligible.

## Tests

- Fault-injection focus — PASS, 9 tests.
- `pnpm typecheck` — PASS.

## Evidence

- The fake Provider receives and commits the real start before Runtime loses the response.
- The lease is consumed once and then cannot suppress a second response.
- Provider/Adapter code receives no fault switch or diagnostic metadata.
- Disabled, production-profile, expired, over-TTL and weapon scopes fail closed.
- The fault contract contains no Benchmark Case ID.

## Remaining risks/blockers

- Optional internal HTTP arming is deferred to S11 and must preserve the same gates.

## Exit gate

PASS
