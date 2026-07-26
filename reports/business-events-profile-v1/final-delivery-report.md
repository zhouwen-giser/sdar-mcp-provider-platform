# SDAR Business Events Profile V1 — Final Delivery Report

## Delivery identity

- Requirements: `SDAR_v1.2.2_Business_Events_Provider_Runtime_Requirements_V0.5.2.md`
- Requirements SHA-256: `a17ee1552bc5b516dabdcc24db2fe9fd2d3deaf74688eae51e2fdc0c6a24cc0f`
- Baseline: `ee14d2fa2b5130d3c7c016c71737175a124d5134` (ancestor of the feature branch)
- Frozen Tasks contract SHA-256: `d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`
- Migration: `023_business_events_profile_v1.sql`; historical migrations are unchanged.
- Feature default: `BUSINESS_EVENTS_ENABLED=false`; Business Events are not a Runtime readiness dependency by default.

## Architecture delivered

PostgreSQL owns source cursor/lease/fencing, inbox and poison facts, immutable runtime events, generation/continuity history, visibility facts, and opaque relation projections. Adapter gRPC source intake is separated from mapping/finalization by a per-source publication barrier. Atomic rotation preserves a drainable `replayable_closed` generation. MCP Business Event SSE maintains independent scanned and delivered cursors, performs authorization projection, and remains wire-independent from Task Notifications.

The Runtime launches one fenced worker per frozen source roster entry, supports durable and best-effort sources, applies bounded subscription/queue/replay controls, exposes component and per-source readiness, and emits only bounded metrics. Operator PITR handling is documented in `docs/operations/business-events-recovery.md`.

## PDR-BE-01–14 traceability

| Decision                      | Delivered evidence                                                                  |
| ----------------------------- | ----------------------------------------------------------------------------------- |
| PDR-BE-01 lock order          | Migration constraints, repository transaction order, fencing and concurrency suites |
| PDR-BE-02 rotation drain      | generation history, rotated replay and continuity suites                            |
| PDR-BE-03 poison storage      | nullable normalized inbox plus poison rotation suite                                |
| PDR-BE-04 blocked source      | source state, degraded readiness and Ack roster semantics                           |
| PDR-BE-05 1–16 sources        | manifest validation, frozen roster and capacity baseline                            |
| PDR-BE-06 reliability classes | durable/best-effort Adapter and discovery/Ack tests                                 |
| PDR-BE-07 Proto evolution     | additive RPC/messages, generated-diff and TS/Python golden tests                    |
| PDR-BE-08 retention/capacity  | retention authorities, cleanup, security and capacity reports                       |
| PDR-BE-09 relation token      | PostgreSQL token hash/projection items and cross-replica paging                     |
| PDR-BE-10 operator rotation   | idempotent CLI and PITR runbook                                                     |
| PDR-BE-11 readiness           | seven component/source readiness keys; opt-in coupling                              |
| PDR-BE-12 claim governance    | machine reports and real-SDAR blocker                                               |
| PDR-BE-13 Git baseline        | latest `origin/main` contains required `ee14d2f` ancestor                           |
| PDR-BE-14 feature switch      | disabled defaults in runtime, env, Kubernetes and Compose                           |

## Claims and verification

- Contract claim: V0.5.2 requirements lock and 81-case catalog passed.
- Source claim: TypeScript/Python Adapter component evidence covers durable and best-effort semantics.
- Runtime claim: Level 2 Business Events Runtime Component Conformance; 9/9 generated suites passed.
- Regression claim: Frozen 74/74, Runtime Closure/Follow-up, PR #16, notification/MRTR/evidence, Integration 199/199, Climate Provider 8/8, security, deployment, SBOM, container and capacity gates passed locally.
- Compose claim: disabled default stack remains configured; the `business-events` profile reached ready with PostgreSQL, TypeScript Adapter and all Business Event readiness components.
- Dependency audit: no high/critical vulnerability; one moderate vulnerability remains below the configured high-severity gate.

## External boundary and release policy

No `SDAR_INTEROP_REPO` or `SDAR_INTEROP_COMMAND` was available. `interop-blocker.json` therefore records the unexecuted real-SDAR matrix. This delivery does not claim Interop Certified status and does not freeze the implemented profile beyond its proven component-conformance level.

The branch is intended for one Draft PR. No tag was created, no auto-merge was enabled, and no merge was performed.
