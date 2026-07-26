# SDAR MCP Tasks Runtime v1.0.0-rc.2 Final Delivery Report

## 1. Release identity

- Branch: `feature/mcp-tasks-provider-runtime-v1`
- Verified implementation commit: `70de271`
- Tag: **not created**; release-governance gate remains blocked
- PR: merged index PR #1; active rc.2 continuation PR #4
- CI runs: `29544205005`, `29544206323`, `29544206369`, `29544206345`, all current rc.2 runs PASS

## 2. rc.1 findings closure

| Finding | Result | Implementation                                         | Tests                          | Residual risk                                       |
| ------- | ------ | ------------------------------------------------------ | ------------------------------ | --------------------------------------------------- |
| F-001   | closed | durable stop dispatcher/rejection policy               | T-001..006                     | Adapter safe-stop policy remains resource-specific  |
| F-002   | closed | immediate start watchdog/compensation                  | T-007..009                     | clock skew must be monitored                        |
| F-003   | closed | scheduled retry/backoff/window                         | T-010..013                     | real capacity policy is Adapter-owned               |
| F-004   | closed | atomic transition/Observation/Outbox                   | T-014..016                     | Outbox consumer remains external                    |
| F-005   | closed | immutable snapshot resolution                          | T-017..018                     | incompatible Adapter removal still blocks readiness |
| F-006   | closed | full execution/control identity checks                 | T-019..022                     | malicious Adapter remains outside trust boundary    |
| F-007   | closed | renewable TTL, expiry and purge                        | T-023..026                     | retention values require operator sizing            |
| F-008   | closed | stale persisted tasks/get fallback                     | T-027..028                     | contract/identity faults never degrade              |
| F-009   | closed | journal-first cancel Ack                               | T-029..030                     | clients must poll for terminal proof                |
| F-010   | closed | output schema validation                               | T-031..033                     | schemas cannot prove business truth                 |
| F-011   | closed | technical/business result separation                   | T-034..036                     | clients must honor both channels                    |
| F-012   | closed | typed JSON-RPC mapping                                 | T-037..039                     | messages may change; reason codes are stable        |
| F-013   | closed | official ttl/poll plus namespaced aliases              | T-040                          | aliases remain compatibility-only                   |
| F-014   | closed | continuous component readiness                         | T-041..042                     | DescribeProvider is not deep resource health        |
| F-015   | closed | bounded per-replica limiter                            | T-043                          | global quota needs ingress support                  |
| F-016   | closed | durable idempotency lease; short DB transactions       | T-044 plus pool-one regression | lease timeout requires configuration discipline     |
| F-017   | closed | frozen prod-only non-root image                        | T-045                          | engine size reporting differs by platform           |
| F-018   | closed | explicit stateless HTTP mode                           | T-046                          | no resumability or task notifications               |
| F-019   | closed | 17-case dual-language protocol suite and scoped claims | T-048..049                     | real-resource safety not claimed                    |

## 3. Architecture changes

Migrations 007-012 add durable command dispatch, start-attempt/window state, Runtime observation
revision/event keys, provider execution identity, handle retention and idempotency leases. Runtime
workers claim short PostgreSQL transactions, release connections before gRPC, and recover by
stable identity and immutable operation snapshot. H9 also removes post-commit pool re-borrowing.

## 4. State machine and timing semantics

Cancel/deadline/window requests persist intent and `STOPPING` before RPC. Ack is never safe-stop
proof. Immediate and scheduled start windows, retries and compensation follow the frozen matrix;
terminal state is irreversible. Runtime observations advance independently of Adapter revisions
and atomically update current Task, Observation and Outbox.

## 5. Database migration and upgrade evidence

Published 001-006 normalized checksums are pinned and unchanged. T-047 constructs actual rc.1
data, applies 007-012 twice, verifies backfills/constraints and executes Recovery -> Dispatcher ->
Scheduler against old rows. Historical Tasks remain bound to saved snapshots. No down migration
is claimed.

## 6. Adapter protocol and identity validation

Start, Get, Reconcile and control Acks validate task, external execution, operation, argument,
authorization, mode/simulation and sequence identity. TypeScript and Python pass 17/17 protocol
cases. Reports declare Adapter protocol passed, Runtime Profile partial and resource-specific
safety not claimed.

## 7. MCP wire compatibility

Official clients and raw wire tests cover typed JSON-RPC errors, business/technical result
channels, output schema, expiry/non-disclosure, capability errors and official `ttl`/
`pollInterval` plus namespaced aliases. HTTP is intentionally stateless.

## 8. Security, recovery and observability

mTLS/JWT/trusted-header modes, execution-context isolation, complexity/rate bounds, identity
conflicts, restart/response loss, multi-worker claims and database outages are tested. Readiness
separates six dependencies. Metrics and structured traces avoid arguments/secrets; Outbox event
keys and observation revisions support idempotent external publication.

## 9. Test results

T-001 through T-050 are mapped to executable evidence and PASS. Current counts are unit 27,
contract 4, rc.2 guards 6, integration 60, recovery 8, security 6 and E2E 4. Both Adapters pass
17/17. `verify:rc2`, Buf lint/breaking, PostgreSQL 17, SBOM/audit/deployment, Docker and all three
Compose images pass in the current H9 runs.

## 10. Capacity and image evidence

Local isolated-schema evidence records: 750 ms slow Adapter with a 1.04 ms pool query; dispatcher
20/20 at 44.34 commands/s; future scheduled scan 32; watchdog 16/16; recovery candidate scans
100/500/1000; Observation +155 rows/+65,536 bytes; Outbox +155 rows/+147,456 bytes. The
authoritative Linux image is 327,026,557 bytes under 350,000,000, non-root and reproducible.
These are regression baselines, not production SLOs.

## 11. Remaining limitations

- Merged PR #1 retains two historical formatting failures. Current PR #4 is fully green, but
  GitHub cannot attach rc.2 commits/checks to the merged PR; this blocks the literal release gate.
- Real external resource safe-stop and side-effect qualification is not provided by Mock
  Adapters.
- Stateless HTTP omits resumption, GET/DELETE session lifecycle and server task notifications.
- Rate limiting is per replica; global quotas require ingress infrastructure.
- Idempotency has no lease heartbeat; lease must exceed Adapter RPC timeout.
- Local Windows grpc-tools cannot load; Linux Docker/CI is authoritative.

## 12. Definition of Done

- Functional, data/reliability and T-001..T-050 requirements: **PASS**.
- `pnpm verify:rc2`, Buf, Compose, dual-language conformance and migration upgrade: **PASS**.
- H0-H8 phase implementation/report/commit/push: **PASS**.
- H9 implementation, documentation, final report and current CI: **PASS**.
- PR #1 title/body rc.2 update: **PASS**.
- PR #1 historical rollup all green: **BLOCKED**.
- Annotated `v1.0.0-rc.2` tag: **NOT CREATED because the preceding gate is blocked**.
- `v1.0.0-rc.1` immutability: **PASS**.

The Goal is not declared complete while the two final release-governance conditions remain
unsatisfied.

## 13. Release/tag evidence

The report-containing commit must pass both push and PR workflows. If the PR #1 condition is
explicitly replaced by the green continuation PR #4 criterion, create the annotated tag only on
that verified clean commit and push it without force. Until then `v1.0.0-rc.2` must remain absent.
