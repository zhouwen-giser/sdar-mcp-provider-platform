# Runtime V1.0 Execution Plan

Status: active  
Target: `v1.0.0-rc.1`  
Branch: `feature/mcp-tasks-provider-runtime-v1`  
Last updated: 2026-07-16 (R8)

## Objective and non-negotiable gates

Deliver a separately deployable TypeScript SDAR MCP Tasks Provider Runtime with
Streamable HTTP, PostgreSQL authority, gRPC/Protobuf Adapter protocol, complete
Profile P0-P4 lifecycle semantics, durable scheduling and recovery, and the
same conformance scenarios passing against TypeScript and Python Adapters.

Every R0-R9 phase must update this plan and traceability, add implementation or
delivery evidence, run its acceptance commands, write the five phase report
files, create one phase-specific commit, fetch/synchronize upstream, and push
immediately. A phase does not advance with unexplained skipped tests or TODO
implementation.

## Normative inputs and resolved priority

1. `references/SDAR_MCP_Tasks_Provider_Profile_V1.0.md`
2. `references/SDAR_MCP_Tasks_Runtime_Design_V1.0.md`
3. `references/SDAR_MCP_Tasks_Adapter_Design_V1.0.md`
4. Frozen decisions in the Codex Goal task package
5. Repository conventions introduced by this plan

## Progress

| Phase | Scope                                                                              | Exit evidence                                        | Status                                         |
| ----- | ---------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- |
| R0    | Repository assessment, baseline, architecture decisions, traceability              | Baseline recorded; every requirement mapped          | completed                                      |
| R1    | Workspace, Runtime health/config, Proto, TS/Python Adapter foundations, Compose    | gRPC DescribeProvider and healthy Compose            | completed                                      |
| R2    | Manifest registry, snapshots, dynamic tools, MCP Streamable HTTP, synchronous call | MCP client lists/calls sync tool; snapshot stable    | completed (`11ed06c`, CI green)                |
| R3    | Migrations, task repository/state engine, admission, `tasks/get`                   | async lifecycle and restart query                    | completed (`98cc5a0`, fix `db21497`, CI green) |
| R4    | Availability, full idempotency, admission recovery/concurrency                     | one external execution per duplicate/concurrent call | completed (`8c23d2d`, fix `df5898e`, CI green) |
| R5    | DB scheduler, timing contract, start windows, deadlines                            | clock/time matrix and restart claims pass            | completed (`28d35d9`, CI green)                |
| R6    | update/input, cancel/stop, observations/outbox, pause/resume gateway               | no premature cancellation; stable revisions/inputs   | completed (`3b896ca`, fix `e619a1d`, CI green) |
| R7    | reconcile/recovery, auth/mode isolation, mTLS, limits, telemetry                   | fault/security suites and readiness pass             | completed (`bb5e941`, fix `e5736f7`, CI green) |
| R8    | P0-P4 conformance CLI, complete TS/Python Adapters                                 | machine-readable dual-language results               | completed (`9d603a6`, fixes through `380487c`) |
| R9    | production images/deployments/docs/audit/capacity/release                          | `pnpm verify`, final report, ready PR, RC tag        | completed                                      |

## Phase execution details

### R0 — freeze the implementation baseline

- Preserve user-supplied task inputs and branch from current `origin/main`.
- Record the actual empty-project build/test failures and local prerequisites.
- Establish module, persistence, protocol, and scheduler ADRs.
- Expand requirement mappings to concrete code and test paths.

Acceptance: documents exist, facts match the repository, all RQ groups map to a
phase and a verification suite.

### R1 — foundation and Adapter protocol

- Create pinned pnpm workspace, TS project references, strict ESM settings,
  ESLint/Prettier/Vitest, build orchestration, and CI.
- Define complete adapter v1 Proto including conditional RPCs, side-effect
  identity fields, snapshots, timing, availability, resources, and comments for
  synchronous/task-capable/task-required publication semantics.
- Generate/lint protocol types reproducibly without global `protoc`.
- Implement config, structured logs, live/ready endpoints and gRPC gateway.
- Implement durable TS and Python Adapter skeletons and Compose PostgreSQL stack.

Acceptance commands: formatting, lint, typecheck, build, unit/contract tests,
Proto checks, Compose config/health smoke.

### R2 — registry and MCP catalog

- Validate Manifest version/IDs/unique operations/capability combinations and
  bounded Draft 2020-12 schemas; canonicalize and hash snapshots.
- Persist immutable operation snapshots and load only on startup.
- Expose initialize, tools/list, tools/call and profile metadata over official
  MCP Streamable HTTP; keep SDK types inside the protocol boundary.
- Complete synchronous and terminal `task_capable` calls through gRPC.

Acceptance: real MCP client round trip, restart-stable snapshots, malicious
manifest tests, illegal scheduling combinations rejected.

### R3 — P0 task lifecycle

- Add append-only core migrations and typed SQL repositories.
- Implement domain transition table and Snapshot mapping with terminal CAS.
- Persist admission intent before immediate StartOperation and publish accepted
  tasks atomically with initial observation/outbox.
- Implement task-required/task-capable results and authorized `tasks/get`.
- Exercise response-loss and commit-failure windows with real PostgreSQL/gRPC.

Implementation: complete. Local strict build/unit/contract/security and real-socket
gRPC/MCP regression gates pass. PostgreSQL lifecycle, restart, immediate-query,
response-loss, and injected commit-failure tests are committed for the Phase CI gate.

### R4 — availability and idempotency

- Add batch availability mapping, validation, time-window normalization, and
  explicit unknown fallback on Adapter transient failure.
- Bind authorization, operation, key, argument hash, and mode in durable unique
  records for synchronous/task/scheduled calls.
- Lock/coordinate admission so concurrent Runtime requests produce one Adapter
  side effect; recover pending intents by Reconcile.

Implementation: complete for immediate calls. The PostgreSQL advisory lock spans
final admission and serializes multiple Runtime instances; stable taskId and
pending records drive Reconcile after response loss. Scheduled idempotency joins
the same repository in R5. P1 batch/window/unknown behavior is covered at the MCP,
gRPC, domain, and real-PostgreSQL integration layers.

### R5 — durable timing

- Compute accepted/not-before/latest-start/deadline anchors in domain code.
- Claim due tasks using PostgreSQL row locking/leases and CAS.
- Enforce no early start, window-missed terminalization, deadline safe-stop, and
  null max-elapsed behavior across restart and multiple workers.
- Use an injected Clock and explicit scheduler ticks in deterministic tests.

Implementation: complete. Profile metadata is validated against Manifest
capabilities; scheduled publication precedes Adapter side effects; PostgreSQL
claims support multiple workers and expired-claim recovery; fake-clock tests
cover no-early-start, one claim, missed windows, null deadlines, and Ack-only
deadline safe stop.

### R6 — controls and observations

- Persist stable input requests and idempotent answers; update is Ack-only.
- Persist cancel/deadline stop intent before gRPC command; keep stopping working
  until a stable Adapter Snapshot; preserve natural-completion races.
- Apply monotonic snapshots, observations, input requests and outbox events in
  one transaction; add outbox publisher and optional notifications.
- Wire conditional update/pause/resume commands with command sequences.

Implementation: complete and CI verified. Migration 005 and PostgreSQL transactions journal
update/cancel/pause/resume intent before gRPC, including the deadline path.
Official MCP task result/cancel plus Profile update/pause/resume are wired.
Stable schema-validated inputs support multiple rounds; duplicate answers,
commands and Snapshot revisions cannot repeat side effects or observations.
Cancellation stays working/stopping until Adapter proof and preserves natural
success and first-writer user/deadline outcomes. GitHub Actions run
`29497170920` passed authoritative PostgreSQL and Compose gates.

### R7 — hardening

- Scan/reconcile uncertain Admissions and nonterminal Tasks at startup and serialize per task.
- Add retry/circuit policies that retain known facts through transient failures.
- Implement trusted/JWT identity, task ownership and execution-mode isolation,
  mTLS client configuration, rate/size/depth limits, and redaction.
- Expose readiness dependencies, metrics, trace correlation, and fault evidence.

Implementation: complete and CI verified. Startup and periodic RecoveryManager scans use
per-task PostgreSQL advisory locks to reconcile uncertain Admissions and nonterminal
Tasks; Recovery does not execute persisted Commands. The Durable Command Dispatcher
exclusively claims and executes Commands, including those whose prior claim lease expired.
Runtime ready waits for migrations, validated Manifest/Adapter connectivity and the initial
scan. Development/trusted-header/JWT authentication, full context isolation, mTLS
credentials, body/rate/JSON limits, redacted correlation logs and Prometheus metrics
are wired. GitHub Actions run `29498655990` passed recovery, security, real PostgreSQL
and Compose gates.

### R8 — cross-language conformance

- Package a CLI/testkit with P0-P4 machine-readable groups.
- Complete durable TS and Python scenarios for availability, sync/async,
  scheduled/input, cancel, idempotency, reconcile, conflict, and terminal rules.
- Run the same HTTP/gRPC scenarios against both Adapter processes.

Implementation: complete. Both reference Adapters expose the same three
operations and persist execution/Snapshot/command binding in atomic state files.
The Testkit restarts each process on the same state, requires Reconcile FOUND,
then runs identical P0-P4 MCP/gRPC/PostgreSQL scenarios and emits JSON reports
validated by a versioned schema. GitHub Actions run `29499994468` passed both
quality and Compose jobs; its artifact is committed under
`reports/conformance/` with all TypeScript and Python P0-P4 groups passing.

### R9 — release candidate

- Finish multi-stage image, Compose example, Helm/Kubernetes, SBOM/audit,
  migration/upgrade/config/operations/Adapter/API/reason-code docs.
- Record reproducible capacity baseline and all final command output.
- Run `pnpm verify` with real PostgreSQL/gRPC/HTTP/Docker/Proto checks.
- Update/open the PR as ready and create non-overwriting `v1.0.0-rc.1` only after
  all Definition of Done items pass.

## Verification strategy

The root scripts are the stable public gates: `format:check`, `lint`,
`typecheck`, `build`, `test:unit`, `test:contract`, `test:integration`,
`test:recovery`, `test:security`, `test:e2e`, `test:conformance`, and `verify`.
Integration gates must fail with an actionable prerequisite error if PostgreSQL,
Docker, generated Proto, or an Adapter is unavailable; they may not silently
pass by omitting suites.

## Upstream and reporting protocol

At every phase start: fetch tags/prune, compare `origin/main` and the tracking
branch, inspect status/log, and merge non-fast-forward upstream changes without
rewriting history. Each report records start/upstream/end evidence and known
limitations. Because a commit cannot contain its own final SHA, the next phase's
first documentation update records the previous phase SHA; final delivery also
contains the authoritative phase SHA table.

## Decision log

- 2026-07-16: greenfield baseline confirmed; no existing stack to preserve.
- 2026-07-16: task-package R0-R9 sequencing controls over the design document's
  older coarse implementation-stage labels.
- 2026-07-16: repository-managed Proto generation avoids dependence on global
  `protoc`; Buf remains a compatibility/release gate.
- 2026-07-16: all Adapter executions use StartOperation; Runtime publication
  behavior is selected by immutable operation execution metadata.
- 2026-07-16: pnpm 11 dependency scripts use an explicit three-package
  `allowBuilds` map; broad install-script execution remains disabled.
- 2026-07-16: local Docker socket access is unavailable to the current user.
  R1 uses the committed GitHub Actions Compose smoke as its Docker health gate.
- 2026-07-16: GitHub Actions artifacts are the authoritative environment for
  Docker, PostgreSQL and Python gates unavailable on the local host; the exact
  R8 JSON artifacts were downloaded through the authenticated GitHub connector
  and committed with formatting-only normalization.
- 2026-07-16: Kubernetes delivery uses dependency-free JSON manifests so the
  repository can validate required production fields without a global Helm or
  kubectl installation; cluster-side dry-run remains an operator rollout step.

## Current next action

Runtime V1.0 RC implementation is complete. Preserve the Ready PR checks and the
non-overwriting `v1.0.0-rc.1` release ref; changes after the RC require a new
version and complete release gate.
