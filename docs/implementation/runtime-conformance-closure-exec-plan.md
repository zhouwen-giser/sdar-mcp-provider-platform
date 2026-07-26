# Runtime Frozen Conformance Closure ExecPlan

Status: complete on main; post-merge frozen interop alignment verified and published as Draft PR #16

Branch: `fix/frozen-interop-contract-alignment`

Post-merge base: `origin/main` at `217e0892c1d827c32c2a5342709fd3e77cfdb259`

## Immutable boundaries

- Frozen contract SHA-256: `d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`
- MCP protocol version: `2026-07-28`
- Runtime target version: `2.0.0-rc.1`
- Home Assistant Climate Provider application, deployment, tests, reports, and report generator are zero-diff content.
- The Home Assistant Light Provider branch and PR #12 are out of scope.
- Historical migrations, the frozen contract, Adapter protocol, Provider Ops contract, and Legacy handler are immutable.

## Post-merge frozen interop amendment (2026-07-22)

PR #15 closed its stated Runtime notification and MRTR scope, but strict SDAR cross-client
verification subsequently exposed three derived-contract mismatches: status-specific fields in
`CreateTaskResult`, missing `reservationMode` on Availability results, and no Adapter wire field
capable of carrying reservation semantics. ADR-011 authorizes the smallest additive Adapter
protocol change needed to restore the frozen external contract. Historical migrations, existing
protobuf field numbers, Provider Ops, and the frozen normative text remain immutable.

| Phase | Deliverable                                         | Gate                                              | Status   |
| ----- | --------------------------------------------------- | ------------------------------------------------- | -------- |
| I0    | Rebase independent fix branch on merged PR #15/main | clean ancestry and reproduced mismatches          | complete |
| I1    | Separate creation and DetailedTask projections      | strict CreateTaskResult regressions               | complete |
| I2    | Add and map explicit Adapter reservation mode       | unit, generated protobuf, TS/Python Adapter tests | complete |
| I3    | Regenerate derived schemas and lock                 | frozen protocol checks and 74/74                  | complete |
| I4    | Full Provider verification and real SDAR interop    | `verify:v2` plus strict cross-repository run      | complete |
| I5    | Evidence, commit, push, and pull request            | immutable commit and green remote checks          | complete |

The final local `pnpm verify:v2` completed in 340.8 seconds with frozen 74/74, Runtime closure
29/29, unit 79/79, contract 9/9, integration 199/199, recovery 9/9, security 29/29, E2E 6/6,
TypeScript/Python Adapter conformance, capacity, SBOM, Kubernetes, reproducible container image,
and RC2 regression gates passing. The dependency audit passes the required high-severity threshold
with one moderate advisory remaining. A real SDAR Frozen client over Streamable HTTP additionally
verified strict discovery, explicit `reservationMode: "none"`, base-only MRTR/business/technical
CreateTaskResult projections, mandatory `tasks/get`, and a Task Notification from the same Runtime
Revision. During that run, strict SDAR discovery also exposed and this branch corrected an unrelated
top-level `resultType` extension on `tools/list`; protocol and Runtime-stack regressions now forbid it.
Implementation commit `b30d839` is published by Draft PR #16 at documentation-only head `50a2b49`
against `main@217e089`. GitHub Actions run `29881484104` completed successfully: both `runtime-ci`
(including `verify:v2`, Buf lint and RC1 protobuf compatibility) and `runtime-compose` passed. Protected
review/merge remains intentionally outside this ExecPlan's automatic actions.

## Ordered execution

| Phase       | Deliverable                                                                    | Gate                                              | Status   |
| ----------- | ------------------------------------------------------------------------------ | ------------------------------------------------- | -------- |
| Baseline    | execution-time main identity and upstream merge ledger                         | required ancestor and clean worktree              | complete |
| H0          | R-001 through R-018 regression tests                                           | failures reproduced before implementation changes | complete |
| H1          | durable MRTR response inbox and atomic terminal transitions                    | real PostgreSQL recovery and idempotency tests    | complete |
| H2          | frozen Runtime error mapper                                                    | safe `-32602`/`-32603` classification tests       | complete |
| H3-H5       | transport-scoped typed subscriptions and authoritative notification projection | multi-client identity and strict equality tests   | complete |
| H6-H7       | Runtime poll manager, batched reads, bounded queues, backpressure, metrics     | capacity, SQL-count, and slow-stream tests        | complete |
| H8          | strengthened conformance and machine reports                                   | 74/74 plus closure suite                          | complete |
| Publication | final main merge, full gates, phased pushes, Draft PR                          | CI and protected zero-diff checks                 | complete |

## Verification policy

Each implementation phase runs format, lint, typecheck, build, `git diff --check`, and status before push. Final verification follows the V1.1 task package verbatim and records real, simulated, and unverified evidence separately.
