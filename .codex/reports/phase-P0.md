# Phase Report

- Phase: Goal 1 / P0 Baseline Lock
- Git commit: phase evidence through `e659697`; this report and the final
  `G1-P0-B06` task state are committed together
- Tasks passed: `G1-P0-B01`, `G1-P0-B02`, `G1-P0-B03`, `G1-P0-B04`,
  `G1-P0-B05`, `G1-P0-B06`
- Tests/evidence: source SHA, source lock, protocol lock, frozen 74-case gate,
  Provider unit/contract/focused suites, machine-readable qualification baseline
- External gaps: real UGV, NPC Tank, and Home Assistant resources were not
  available and real-resource qualification remains explicitly not claimed
- Decisions/ADRs: no architecture decision or ADR was required; P0 retained all
  delivered authority and compatibility boundaries
- Residual risks: real-device and supplier-environment conformance remains
  external; PM2 is not installed and is not required until Goal 2
- Next phase readiness: ready for P1 Migration isolation without changing
  delivered SQL semantics

## Scope and commits

| Task | Result | Commit | Primary evidence |
|---|---|---|---|
| `G1-P0-B01` | PASSED | `3513476` | `docs/baseline/BASELINE_INVENTORY.json`, `docs/baseline/BASELINE_REPORT.md` |
| `G1-P0-B02` | PASSED | `50ecf47` | `docs/baseline/SOURCE_LOCK.json` |
| `G1-P0-B03` | PASSED | `87644e1` | `README.md`, `docs/architecture/platform-scope.md` |
| `G1-P0-B04` | PASSED | `107940a` | `docs/baseline/FROZEN_PROTOCOL_GATE.md` |
| `G1-P0-B05` | PASSED | `e659697` | `docs/baseline/PROVIDER_QUALIFICATION_BASELINE.json` |
| `G1-P0-B06` | PASSED | this report commit | `.codex/reports/phase-P0.md` |

The required Goal branch is `codex/goal-01-platform-foundation`. The immutable
offline import is root commit
`ad199f508cf67dbe77491cf90569daf5da8197bb`; its archive SHA-256 is
`000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`.
The pre-existing split initialization histories were joined with merge commit
`a63e834` without rewriting either history.

## Architecture and change boundary

P0 changed repository identity and evidence only. It did not refactor Runtime
or Provider core, modify a delivered Migration, change frozen protocol assets,
weaken a test, or delete a compatibility script.

The documented boundary remains:

- PMS is the control plane and does not access Runtime Task business tables or
  proxy MCP business traffic.
- Runtime remains Task Authority and the MCP data plane without a PMS
  persistence dependency.
- Provider Adapters retain device facts, Operation side effects, and device
  safety; production Adapters remain supplier-managed by default.

## Gate results

| Command | Result | Evidence or note |
|---|---|---|
| `bash .codex/task-package/scripts/verify_source_baseline.sh` | PASS | Fixed archive SHA matched |
| `pnpm protocol:check` | PASS | Frozen contract, pinned Schema, 11 schemas, 74-case catalog, 38-file lock |
| `TEST_DATABASE_URL=<local> pnpm test:frozen-74` | PASS | 74/74; tracked report remained byte-equivalent |
| `pnpm test:unit` | PASS | 29/29 files, 121/121 tests |
| `pnpm test:contract` | PASS | 4/4 files, 18/18 tests |
| `pnpm test:ugv-provider:unit` | PASS | 9/9 tests |
| `pnpm test:ugv-provider:contract` | PASS | 4/4 tests |
| `pnpm test:npc-tank-provider:unit` | PASS | 11/11 tests |
| `pnpm test:npc-tank-provider:contract` | PASS | 5/5 tests |
| `pnpm test:ha-climate` | PASS | 4/4 files, 7/7 tests |
| `git diff --check` | PASS | No whitespace errors |

## Failures, diagnosis, and disposition

There are no unexplained test failures.

- The first contract run passed 16/18 assertions but the sandbox rejected two
  `spawnSync python3` calls with `EPERM`. The same unchanged suite passed 18/18
  when local process execution was allowed.
- The first Home Assistant focused run could not bind fake fixtures to
  `127.0.0.1` in the network sandbox and timed out. The same unchanged suite
  passed 7/7 when loopback listening was allowed.
- The B03 command `pnpm format:check || true` initially could not install
  dependencies because the default pnpm store was read-only. Locked
  dependencies were subsequently installed in B04; machine checks and
  `git diff --check` passed. No empty or always-successful replacement script
  was introduced.

## Qualification and external gaps

All three delivered Providers have a current component baseline:

- UGV: unit 9/9 and contract 4/4; component claim remains limited to the
  supplied protocol and Mock Level 1 contract.
- NPC Tank: unit 11/11 and contract 5/5; component claim remains limited to the
  supplied protocol and Mock Level 1 contract.
- Home Assistant Climate: focused unit/integration/recovery/security 7/7;
  component-conformant claim retained.

Mock MCP servers, MQTT publishers, and Fake Home Assistant are test fixtures.
They are excluded from production and real-resource qualification. Missing real
Device MCP endpoints, real ISR MQTT samples, physical climate devices, and an
independently managed Home Assistant deployment are recorded as unverified, not
as passed.

## Exit conclusion

- P0 tasks are PASSED with commits and evidence paths recorded.
- Runtime/Provider core and delivered Migrations remain unchanged.
- P1 may begin by documenting Migration ownership before any physical movement
  or Runner change.
