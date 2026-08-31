# Phase S12 Report — Controlled UGV qualification

## Source

- Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`
- Parent phase: S11 `e442492`
- Evidence level: controlled local integration with the existing UGV Adapter and mock Device MCP; not a live external UGV Run.

## Changes

- Extended the vendor-managed UGV platform fixture through the real Runtime→gRPC Adapter and Provider Telemetry→ProviderOps paths.
- Added a controlled point-navigation qualification for idempotency, identity closure, business terminal, physical observation time and Mission relation.
- Added an after-commit response-loss qualification using the gated one-shot transport seam.
- Corrected the generic vehicle gRPC server to treat protobuf's empty external-execution default as absent during exact reconciliation.

## Tests

- `tests/provider-platform-e2e/ugv/vendor-managed.test.ts` — PASS, 5 tests.
- `pnpm typecheck` — PASS.

## Evidence

- Repeating the same idempotency identity returns one Task and causes one UGV Adapter start flow.
- The Adapter execution ID exactly matches Runtime binding authority.
- Position, speed and Mission observations traverse Provider Telemetry with source `observedAt` preserved.
- Authoritative device Mission ID `1` produces an exact Task→ExternalExecution→DeviceMission relation.
- MCP completion and business success are separately represented, with no Goal-success field.
- The response-loss lease is consumed once; Runtime persists `redispatchAllowed=false`, reconciles FOUND with validated identity, and performs no second Device MCP start flow.

## Remaining risks/blockers

- This is controlled fixture evidence, not live Provider evidence.
- The frozen Telemetry canonical Mission relation projector remains externally blocked.

## Exit gate

PASS — safe independent UGV qualification complete
