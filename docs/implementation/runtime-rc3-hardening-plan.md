# Runtime v1.0.0-rc.3 Reliability Hardening Plan

Date: 2026-07-17

Baseline commit: `128b2b1`

Release branch: `release/1.0.0-rc.3`

## Scope

This release hardens the v1.0.0-rc.2 Runtime without adding product features. Published rc.2
migrations, reports, protocol contracts and release history remain immutable. New database
changes are forward-only migrations beginning at 013.

## rc.2 findings carried into rc.3

- Command claims were processed serially after a batch claim and had no heartbeat; a slow
  Adapter could let later claims expire before their RPC began.
- Immediate and scheduled execution paths did not share one post-binding start-confirmation
  watchdog.
- A non-terminal Adapter snapshot could regress a Task from STOPPING to RUNNING or PAUSED.
- Boolean environment coercion and production defaults did not fail closed.
- Startup Manifest identity was not monitored for drift.
- Transactional Outbox insertion existed without a Runtime-owned publisher lifecycle.
- `tasks/get` returned unbounded Observation history.
- Repeatedly failing Tasks could monopolize recovery scans.
- Result validation order was not uniform across business failures and start-window results.
- Repository rules and rc.3 release evidence needed an explicit, reproducible release gate.

## rc.3 goals

1. Preserve single-owner side effects across Runtime replicas and slow Adapter calls.
2. Apply one reconciliation-first start-window policy to every bound execution.
3. Preserve stop intent until a terminal Adapter state is confirmed.
4. Reject ambiguous or unsafe production configuration.
5. Complete health, publication, pagination, recovery and result lifecycles.
6. Produce auditable migration, race, security, capacity and release evidence.

## Issue and test mapping

| Phase | Reliability issue                      | Implementation target                                   | Regression evidence                 |
| ----- | -------------------------------------- | ------------------------------------------------------- | ----------------------------------- |
| H0    | Unrecorded rc.3 scope                  | This plan and changelog baseline                        | clean branch; baseline checks       |
| H1    | Batch lease expiry and duplicate RPC   | per-command workers, bounded concurrency, claim renewal | `lease-expiry-race.test.ts`         |
| H2    | Split or missing bound-start handling  | migration 014 and `BoundExecutionWatchdog`              | `start-window-race.test.ts`         |
| H3    | STOPPING state regression              | snapshot stop-state merge rule                          | `stopping-state-regression.test.ts` |
| H4    | Unsafe production coercion/defaults    | strict boolean parser and production guards             | `production-config.test.ts`         |
| H5    | Undetected Manifest drift              | `AdapterManifestWatcher` and readiness                  | `manifest-drift.test.ts`            |
| H6    | Outbox publication lifecycle gap       | `OutboxPublisher` and sinks                             | `outbox-publish-lifecycle.test.ts`  |
| H7    | Unbounded Observation reads            | cursor API and `(task_id, revision DESC)` index         | `observation-pagination.test.ts`    |
| H8    | Recovery starvation                    | migration 015 and exponential backoff                   | `recovery-fairness.test.ts`         |
| H9    | Inconsistent result validation         | size, sanitize, schema, MCP result pipeline             | `result-contract-hardening.test.ts` |
| H10   | Drifted checks and incomplete evidence | rc.3 reports, capacity and repository policy            | full `pnpm verify` release gate     |

## Phase order and commit policy

H0 through H10 execute in order. Each phase receives a dedicated commit after its scoped tests
pass. H10 regenerates release evidence only after migration-upgrade and two-replica race suites
pass. The branch is pushed and a draft pull request is prepared only after the full release gate
is green.

## Acceptance gates

- zero duplicate command Adapter side effects in the two-replica slow-Adapter race;
- zero false start-window stops and zero STOPPING regressions;
- production configuration fails closed and Manifest drift changes readiness;
- Outbox publication permits TTL purge and Observation history remains bounded;
- recovery gives new candidates service despite persistent failures;
- all result variants validate after sanitization;
- append-only migration upgrade, all tests, `pnpm verify`, and regenerated rc.3 evidence pass.

## Execution record

| Phase | Commit    | Status   |
| ----- | --------- | -------- |
| H0    | `1c85124` | complete |
| H1    | `b26b62f` | complete |
| H2    | `89a6707` | complete |
| H3    | `77ab5c5` | complete |
| H4    | `2afccad` | complete |
| H5    | `d91f219` | complete |
| H6    | `abfd707` | complete |
| H7    | `c997578` | complete |
| H8    | `dc30f45` | complete |
| H9    | `dc9a60b` | complete |
| H10   | `f658bdc` | complete |

The full `pnpm verify:rc3` gate passed on 2026-07-17 against PostgreSQL 17 and Docker Desktop. It
included 27 unit, 4 contract, 77 integration, 8 recovery, 16 security, 4 E2E and 6 rc.1 guard
tests; TypeScript/Python conformance; rc.1 and rc.2 forward migration; reproducible images; and the
required two-replica capacity workload. H10 release reports record the exact governance commit.
