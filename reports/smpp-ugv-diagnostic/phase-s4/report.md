# Phase S4 Report — Durable dispatch uncertainty

## Source

- Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Parent phase: S3 `5207ff3`

## Changes

- Added append-only Runtime migration `025_smpp_dispatch_uncertainty.sql`.
- `markAdmissionUncertain()` now atomically persists the frozen uncertainty document and a legal `provider.recovery.lifecycle` ProviderOps fact.
- The durable model enforces `redispatchAllowed=false` at the database and JSON-contract levels.
- Adapter transport ambiguity and post-Adapter/pre-publication crash windows receive explicit standard classifications.

## Tests

- Uncertainty + migration source-map tests — PASS, 3 tests.
- `pnpm test:migration-isolation` — PASS.
- Existing idempotent response-loss recovery focus — PASS.
- `pnpm typecheck` — PASS.

## Evidence

- Admission state, uncertainty document and ProviderOps delivery commit atomically.
- Repeated marking is idempotent and preserves the first causal fact.
- ProviderOps uses the already legal `provider.recovery.lifecycle` record family.

## Remaining risks/blockers

- Downstream ProviderOps 1.1.0 projection compatibility remains an S10/S13 gate.

## Exit gate

PASS
