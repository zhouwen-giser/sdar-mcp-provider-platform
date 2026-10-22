# ExecPlan: restore the local UGV adapter and verify controls

Started 2026-10-22. Status: isolated regressions passed; local update pending. Branch: `codex/restore-ugv-adapter-20261022`.

## Authorization and scope

The user requested restoring the adapter chain, verifying admission, then retesting
device controls. Preserve deployment bindings, database volumes, signing authority,
PMS configuration, weapon policy and the uncertain invocation's identity. Original
packaging changes remain untouched in the user's checkout. No physical invocation
may be replayed after an ambiguous response.

## Evidence and findings

Evidence is recorded in `/mnt/data/device-controls-recovery-20261022-66b90521`.
The earlier emergency stop was dispatched late and is durably TECHNICAL_FAILED /
STOP_CONFIRMATION_TIMEOUT. It must be recovered, never sent again. A disconnected
history reader continued its unbounded count over 27 million retained receipts,
holding the history fence after the adapter was stopped. Its exact PID, query hash,
source address and start time were checked before cancelling only that read. The
unchanged adapter restarted and reached READY with both transports connected.
Slow snapshot persistence can hold the single mutation queue ahead of controls.
GOWM also adds a reconciliation-audit FK to provider_task, so recording FOUND before
publishing a recovered Task prevents this admission from converging.

## Implementation and validation

- [x] Keep ordered observation projections but admit priority control work while
      an earlier observation is waiting for snapshot persistence. Keep read queries
      independent of the control queue; reject queued starts after RPC cancellation.
- [x] Bound history fence waits and SQL execution; preserve complete proof semantics
      and every stored receipt. No history deletion or invented completeness.
- [x] Publish identity-validated recovered Tasks before recording FOUND; retain the
      failed result and never redispatch. Document the remaining upstream constraint
      on pre-publication unavailable/not-found audit records.
- [x] Run queue/cancellation, adapter lifecycle, history and admission regressions,
      type checking, lint and image build checks. Use only owned isolated test stores.
- [ ] Update only the local SMPP services, verify immutable configuration and image
      identity, fresh MQTT and Device MCP, stable old task recovery, and idle state.
- [ ] Retest permitted non-weapon controls with bounded parameters. Record actual
      action, lifecycle, evidence and limitations separately from availability checks.

## Rollback

Restore the saved prior image references with the same mounts and configuration.
Keep all task, admission, mutation and receipt history. Do not replay the old stop.

## Validation receipts

- `regression01`: 138/138 passed, including actual PostgreSQL fence timeouts and
  recovered failed admission under an extra hosted Task FK; no physical redispatch.
- `business-lifecycle01`: 428/428 passed, including AutoLock and RequiredInput.
- `typecheck01`, `lint02`, `build01`: exit 0 with Node 22 / pnpm 11.13.1.
- Initial queue test expected the wrong wire state (STARTING versus ACCEPTED);
  corrected to the existing wire contract. Initial lint rejection typing was
  repaired without changing lint policy. Both failed attempts remain recorded.
