# Goal 2 baseline

Status: READY

## Repository gate

| Check | Result | Evidence |
| --- | --- | --- |
| Goal branch | PASS | `codex/goal-02-runtime-governance` |
| Active goal | PASS | `goal-02` |
| Initial task state | PASS | 1 READY, 49 PLANNED; `G2-P0-B01` first |
| Goal 1 task state | PASS | archived state contains 50 PASSED and no FAILED, BLOCKED, or IN_PROGRESS |
| Goal 1 handoff verifier | PASS | returned `Goal 1 handoff valid` on clean commit `01257ac` |
| Goal 1 handoff schema fields | PASS | goal/status, source SHA, 50/50 summary, three required gates, and timestamp present |
| Goal 1 test evidence artifact | REPAIRED | required protocol artifact was absent; reconstructed from committed reports and truthful Goal 2 smoke reruns |

Goal 2 was activated with the repository `init_state.py` initializer because the in-repository
`prepare_goal2.sh` cannot safely copy its task package over itself. Activation commit: `cbc7822`.
No task state was edited manually.

## Baseline commits and toolchain

- Goal 2 base: `01257ac846d541a4402548b1a82595bdb6d0b31a`.
- Goal 1 implementation handoff: `459c3f9c881816066dfc887e50d7a309733887f2`.
- Goal 1 terminal handoff: `604bd09`.
- Source baseline SHA-256:
  `000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`.
- Node.js: `v22.23.1`.
- pnpm: `11.13.1`.

The handoff implementation and terminal commits are ancestors of the Goal 2 branch. Goal 1's
archived state and handoff artifacts are available under `.codex/archive/goal-01/`; the committed
handoff remains under `.codex/handoff/`.

## Goal 2 smoke rerun

| Command | Result |
| --- | --- |
| `pnpm protocol:check` | PASS; 11 schemas, 74 frozen cases, 38 locked files |
| `pnpm test:provider-packages` | PASS; 13/13 and three-package self-check |
| `pnpm test:config-compat` | PASS; 8/8 plus contract 36/36 |
| `pnpm exec vitest run tests/runtime-config-e2e` | PASS; 3/3 |
| `pnpm test:unit` | PASS; 30 files, 123 tests |
| `TEST_DATABASE_URL=<local-postgres> pnpm test:migration-isolation` | ENVIRONMENT UNAVAILABLE; local endpoint refused connection |
| `TEST_DATABASE_URL=<local-postgres> pnpm test:pms-migrations` | ENVIRONMENT UNAVAILABLE; local endpoint refused connection |
| `TEST_DATABASE_URL=<local-postgres> pnpm test:pms-config-e2e` | ENVIRONMENT UNAVAILABLE; local endpoint refused connection |

The database-dependent Goal 1 gates retain their committed PASS evidence in
`reports/evidence/migration-isolation.json`, `.codex/execution-log.md`, and the Goal 1 delivery
report. The current environment does not provide a running PostgreSQL service, so this baseline
does not claim a fresh database E2E pass. G2-P0-B02 owns the infrastructure inventory and Fake
Adapter strategy.

## Authority baseline

- PMS is the control plane and does not own Runtime Task, Command, Scheduler, Recovery, or Outbox
  business state.
- Runtime remains Task Authority and can cold-start without PMS by using Bootstrap Config and LKG.
- Provider Adapter production defaults to `vendor_managed`.
- Runtime, UGV, NPC Tank, and PMS Migration sets remain physically isolated and append-only.
- Secret values are excluded from this report; database evidence uses `<local-postgres>`.
- Operation Catalog authority remains Runtime `server/discover + tools/list`.

## Known gaps carried into Goal 2

- Real-resource qualification remains pending for UGV, NPC Tank, and Home Assistant Climate.
- The local PostgreSQL service was unavailable during this Goal 2 preflight rerun.
- The supplied handoff verifier does not validate the JSON Schema or require
  `goal1-test-evidence.json`; this task records the missing artifact without weakening the
  verifier or modifying the task package.
