# Runtime rc.2 Requirement Traceability

Status values are `RED_BASELINE`, `IN_PROGRESS`, `PASS`, `N/A_WITH_NORMATIVE_BASIS` or `OPEN`.
No item becomes PASS without executed evidence and a phase commit/CI reference.

| Requirement        | Finding           | Phase | Implementation evidence                                                       | Test evidence                                          | Commit / CI                                 | Status  |
| ------------------ | ----------------- | ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | ------- |
| RC2-CONTROL-01     | F-001/F-009       | H1    | migration 007; durable dispatcher; ADR-004; short claim/finalize transactions | PostgreSQL T-001..T-006,T-029,T-030; 25/25 integration | `3f2d425`; runs `29509615239`,`29509616607` | PASS    |
| RC2-TIME-01        | F-002             | H2    | migration 008; immediate watchdog; late-response durable stop; ADR-005        | PostgreSQL/gRPC T-007..T-009; structural guard green   | `20d4598`; runs `29511568781`,`29511591880` | PASS    |
| RC2-TIME-02        | F-003             | H2    | persisted attempts/backoff; claim-owner CAS; Reconcile-before-retry           | PostgreSQL scheduler/concurrency T-010..T-013          | `20d4598`; runs `29511568781`,`29511591880` | PASS    |
| RC2-OBS-01         | F-004             | H3    | migration 009; unified transition primitive; stable terminal/outbox contract  | PostgreSQL T-014..T-016; 34/34 lifecycle integration   | `f3ad038`,`b599480`; run `29514590381`      | PASS    |
| RC2-SNAPSHOT-01    | F-005             | H4    | immutable snapshot repository; Engine/Scheduler/Recovery snapshot resolution  | PostgreSQL T-017,T-018; rc.2 guard green               | `c58feb7`,`5873a79`; run `29517591379`      | PASS    |
| RC2-IDENTITY-01    | F-006             | H4    | full Snapshot/Ack identity validator; conflict audit/metric; unique binding   | PostgreSQL/gRPC T-019..T-022; rc.2 guard green         | `c58feb7`,`5873a79`; run `29517591379`      | PASS    |
| RC2-TTL-01         | F-007             | H5    | migration 011; renewable active handles; logical expiry and SKIP LOCKED purge | PostgreSQL/MCP T-023..T-026                            | `6360af8`; run `29520212409`                | PASS    |
| RC2-READ-01        | F-008             | H5    | persisted-first get; transient stale meta; background Reconcile               | PostgreSQL/gRPC T-027,T-028                            | `6360af8`; run `29520212409`                | PASS    |
| RC2-WIRE-01        | F-010/F-011/F-012 | H6    | typed hierarchy/mapper; retained output validator; ADR-009                    | official MCP/wire T-031..T-039; integration 54/54      | `787648a`; runs `29539952514`,`29539965808` | PASS    |
| RC2-COMPAT-01      | F-013             | H6    | official ttl/pollInterval; namespaced aliases; strict TTL mapping             | official client + raw wire T-040                       | `787648a`; runs `29539952514`,`29539965808` | PASS    |
| RC2-OPS-01         | F-014/F-015       | H7    | component probes; bounded limiter; ADR-010                                    | T-041..T-043; E2E 4/4                                  | `5c03ce6`; runs `29541564999`,`29541566647` | PASS    |
| RC2-DB-01          | F-016             | H7    | migration 012; short claim/CAS; RPC outside PoolClient                        | T-044 + 001-011 upgrade; integration 57/57             | `5c03ce6`; runs `29541564999`,`29541566647` | PASS    |
| RC2-IMAGE-01       | F-017             | H7    | frozen install; prod prune; reproducible image audit                          | T-045; Linux 327,026,557 bytes/non-root/reproducible   | `3d885be`; runs `29541564999`,`29541566647` | PASS    |
| RC2-MCP-01         | F-018             | H7    | explicit SDK 1.29 stateless transport; no session notification claim          | official multi-client/repeated POST T-046              | `5c03ce6`; runs `29541564999`,`29541566647` | PASS    |
| RC2-MIGRATION-01   | all schema        | H8    | published 001-006 frozen; rc.2 migrations append-only through 012             | full-state 001-006 upgrade T-047, 2/2                  | `e1041a9`; runs `29542809447`,`29542810998` | PASS    |
| RC2-CONFORMANCE-01 | F-019             | H8    | 17 cases/language; schema-guarded separated claim scopes                      | T-048,T-049; TS/Python 17/17 each                      | `e1041a9`; runs `29542809447`,`29542810998` | PASS    |
| RC2-RELEASE-01     | all               | H9    | rc.2 versions, `verify:rc2`, docs, capacity and 50-test matrix                | T-050 green; merged PR #1 historical rollup not green  | `70de271`; runs `29544205005`,`29544206323` | BLOCKED |

## Test inventory

The authoritative scenario definitions are the task package's T-001 through T-050 matrix.
H0 added six expected-red guards for T-007, T-010, T-014, T-017, T-019/T-021 and T-029.
Each owning phase must add the matrix's required real layer; structural guards alone cannot
satisfy final compliance.

## Baseline identities

- rc.1 annotated tag object: `9a4715e6316a23f399ee06eea2444b0245fa1adb`
- rc.1 peeled commit/local/remote branch/PR Head: `51d68926ba1bc9e935438e750582693aea3ecf4d`
- `origin/main`: `7e501d07786a7695d205b0bc92b8fdbd667e7f96`
- PR #1 baseline checks: push and PR `quality`/`compose-smoke` SUCCESS; runs
  `29502133316` and `29502131960`.
