# Runtime v1.0.0-rc.2 Hardening Execution Plan

Status: active  
Branch: `feature/mcp-tasks-provider-runtime-v1`  
Immutable baseline: annotated tag `v1.0.0-rc.1` -> `51d68926ba1bc9e935438e750582693aea3ecf4d`  
Target: annotated tag `v1.0.0-rc.2`  
Last updated: 2026-07-17 (H6 implementation verification)

## Objective and invariants

Close rc.1 findings F-001 through F-019 with executable migrations, PostgreSQL-backed
state machines, protocol validation and black-box regression evidence. A request or Adapter
Ack is never treated as safe-stop proof. Runtime observation revision is independent from
Adapter revision. Historical Tasks always use their immutable Operation Snapshot. No slow
Adapter RPC may run while a database client, transaction or advisory transaction lock is held.

The rc.1 tag is immutable. Work stays on the target feature branch; no force push, history
rewrite, direct `main` commit, skipped test, weakened assertion, mock-only completion claim or
post-tag patch is allowed.

## Authority order

1. Packaged `SDAR_MCP_Tasks_Provider_Profile_V1.0.md`.
2. Packaged Runtime Design DOCX.
3. Packaged Adapter Design DOCX.
4. Frozen rc.1 review findings and rc.2 task-package decisions.
5. Current Adapter Protocol, database compatibility and locked MCP SDK wire schema.
6. Repository conventions.

The task package was verified against all 13 entries in `SHA256SUMS.txt` before use. The two
packaged DOCX files are byte-identical to the repository reference copies.

## Phase protocol

Every H phase follows this loop:

1. fetch tags/prune; compare `origin/main`, the target remote branch and the actual local Head;
2. merge real upstream changes without rewriting pushed history;
3. update this plan, traceability and phase sync evidence;
4. add a failing reproducer before implementation, then implement code/migrations;
5. run required new and old tests without skip/TODO fallbacks;
6. write `reports/runtime-v1-rc2/phase-HN/` evidence and residual risks;
7. create one phase-scoped commit, push, inspect branch and PR checks, and repair failures;
8. advance only when the phase exit criteria are satisfied.

## Progress and exit evidence

| Phase | Scope                                                                         | Required evidence                                             | Status                         |
| ----- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------ |
| H0    | real baseline, six red regressions, plan and matrix                           | baseline assessment, red output, H0 report, push/CI           | complete                       |
| H1    | durable stop command dispatcher and rejection policy                          | T-001..T-006, T-029, T-030; migration; no RPC under DB client | complete                       |
| H2    | immediate watchdog, late response compensation, scheduled retry               | T-007..T-013; multi-instance/response-loss evidence           | complete                       |
| H3    | unified transition, Runtime observation revision and Outbox                   | T-014..T-016 plus lifecycle/control regressions               | complete                       |
| H4    | immutable Snapshot resolution and Adapter identity validation                 | T-017..T-022; Manifest v1->v2 recovery                        | complete                       |
| H5    | TTL expiry/purge and degraded reliable reads                                  | T-023..T-028; multi-instance cleaner                          | complete                       |
| H6    | typed MCP errors, result schema and ttl/poll compatibility                    | T-031..T-040 over real MCP wire                               | complete                       |
| H7    | health, bounded rate limit, idempotency pool, image and HTTP mode             | T-041..T-046; capacity and image proof                        | complete                       |
| H8    | rc.1 forward migration, recovery ordering, expanded dual-language conformance | T-047..T-049 and T-001..T-046 regression                      | complete                       |
| H9    | docs, full release gate, PR #1, final report and immutable tag                | T-050, all checks green, report-containing tag commit         | blocked on merged PR #1 rollup |

## Planned schema evolution

Published migrations 001-006 remain byte-for-byte unchanged. Append-only rc.2 migrations will
cover durable command claim/retry state, independent observation revision, start attempts and
watchdog anchors, task handle expiry/retention, idempotency leases and supporting indexes. H8
will build a real rc.1 fixture at migration 006 and forward-upgrade it.

## Verification strategy

`test:rc2:red` records H0 expected failures separately from normal green CI. From H1 onward its
guards are turned green and replaced/supplemented by real PostgreSQL, gRPC and MCP wire tests.
H9 adds `verify:rc2`, aggregating existing gates, T-001..T-050, Buf compatibility, Compose,
dual-language conformance, upgrade and expanded capacity evidence.

Local environment facts are evidence, not exceptions: Windows CRLF checkout required portable
Prettier handling; the installed grpc-tools native binaries currently fail before execution;
the Windows `python3` app alias is not a usable interpreter. GitHub Actions remains mandatory
for Linux/PostgreSQL/Docker/Python evidence, but local failures must still be fixed or accurately
reported rather than hidden.

## Release protocol

H9 updates PR #1 title/body with F-001..F-019 closure and exact checks. Only after the final
report is committed, both push and PR workflows succeed, the worktree is clean, and rc.1 is
re-verified unchanged may an annotated non-overwriting `v1.0.0-rc.2` tag be created and pushed.
The tag is never moved.

## Decision log

- 2026-07-16 H0: actual local/remote/PR Head equals rc.1 commit `51d6892`; `origin/main` is the
  merge base and the feature branch is 25 commits ahead, 0 behind.
- 2026-07-16 H0: preserve the supplied hardening package byte-for-byte and exclude it from
  Prettier so its verified checksums remain meaningful.
- 2026-07-16 H0: separate expected-red regressions from normal CI until their owning phases
  implement the fixes; an expected red result is never reported as a passing release gate.
- 2026-07-16 H0 closure: commits `4bb2820` and `facc38e`; push run `29508056591` and
  PR run `29508060466` passed quality, Buf and Compose jobs.
- 2026-07-16 H1: command claim and finalization use separate short database transactions;
  Adapter RPC runs between them without a checked-out database connection. User cancellation
  rejection restores only an authoritative Reconcile Snapshot, while mandatory stop rejection
  fails with `SAFE_STOP_UNCONFIRMED`.
- 2026-07-16 H1 closure: implementation `3f2d425`; push run `29509615239` and PR run
  `29509616607` passed `pnpm verify`, Buf lint/compatibility and Compose with both Adapter
  images. The report closure commit follows the evidence it records.
- 2026-07-16 H2: persist start attempts and retry anchors; never retry an uncertain Start before
  Reconcile `NOT_FOUND`; late/queued immediate execution enters durable safe-stop compensation.
- 2026-07-16 H2 upstream event: PR #1 was externally merged while H2 was in progress, and
  governance commit `075d8dc` reached both `main` and the target branch. H2 implementation
  `20d4598` was committed first, then remote target `e768f52` was merged without conflict as
  `a14d4b3`. Draft PR #3 now carries the remaining H2-H9 delta so PR-context checks continue.
- 2026-07-16 H2 closure: push run `29511568781`, PR runtime run `29511591880`, and
  governance quality/Compose runs `29511590472`/`29511590473` all succeeded.
- 2026-07-16 H3: introduced a Runtime-owned observation sequence and one transactional
  transition primitive for Task state, complete observations and stable-key outbox events.
  PostgreSQL fault injection proves that an outbox insertion failure rolls back Task and
  observation changes. Implementation `f3ad038`; push runtime `29514013921`, PR runtime
  `29514017780`, quality `29514019017` and Compose `29514017491` all succeeded.
- 2026-07-16 H3 closure repair: closure push `29514255881` exposed non-canonical JWT
  base64url acceptance; fix `b599480` made JWT segment decoding canonical and passed 20 local
  security repetitions plus push `29514585761`, PR runtime `29514590381`, quality
  `29514592620` and Compose `29514590244`.
- 2026-07-17 H4: historical execution, scheduling, recovery and control now resolve and
  validate the Task-bound immutable Operation Snapshot. Adapter Snapshots and command Acks
  echo the complete execution identity and are rejected atomically on any mismatch; conflicts
  produce a durable audit Outbox event and metric without updating or rebinding the Task.
- 2026-07-17 H4 closure: implementation `c58feb7`; its first full verify exposed a Python Ack
  field omission in runs `29517410128`/`29517412904`. Repair `5873a79` passed push runtime
  `29517588173`, PR runtime `29517591379`, quality `29517591502` and Compose `29517591413`.
- 2026-07-17 H5: migration 011, replica-safe TTL cleaner, typed expired wire error and strict
  transient-only stale read fallback implement T-023..T-028. Active Tasks renew instead of
  expiring; identity/contract errors remain visible.
- 2026-07-17 H5 closure: implementation `6360af8` passed push runtime `29520205271`, PR
  runtime `29520212409`, quality `29520211902` and Compose `29520211382`, including full
  `pnpm verify`, Buf lint/breaking and dual-language Adapter conformance.
- 2026-07-17 H6 implementation: centralized typed Runtime-to-MCP error mapping, retained
  immutable output validators, raw success/validated partial result publication and official
  `ttl`/`pollInterval` plus namespaced SDAR aliases. Official-client and raw Streamable HTTP
  T-031..T-040 pass 10/10; the full PostgreSQL integration suite passes 54/54. Remote
  implementation Head verification remains required before H6 closure.
- 2026-07-17 H6 upstream event: PR #3 was merged at `2d5faa1` after H5 closure. Its tree equals
  H5 Head `e7500d1`, so the target branch fast-forwarded to the merge commit without conflict or
  content change before the H6 implementation commit. A new continuation PR is required for
  H6-H9 PR-context checks.
- 2026-07-17 H6 closure: implementation `787648a` passed push runtime `29539952514`, PR
  runtime `29539965808`, PR quality `29539965866` and PR Compose `29539965781`. These include
  full `pnpm verify`, Buf lint/breaking, dual-language existing conformance and Compose; expanded
  conformance remains assigned to H8.
- 2026-07-17 H7 implementation: migration 012 replaces the idempotency session lock with short
  claim/finalize transactions and a durable lease; continuous component-specific readiness,
  bounded rate state, explicit SDK stateless transport and a pruned/frozen production image
  implement T-041..T-046. Local evidence passed: unit 27, contract 4, guards 6, integration 57
  (including an actual 001-011 rc.1 data upgrade), recovery 8, security 6, E2E 4, dual-language
  then-current 10-case grouped conformance baseline, capacity, SBOM/deployment and the
  reproducible image audit. GitHub Linux
  measured 327,026,557 bytes (350 MB ceiling); Docker Desktop reports 97,150,847 bytes for the
  same filesystem/config shape because its containerd size semantics differ.
  Remote Linux CI remains required before closure; the local Windows grpc-tools binary cannot
  execute (`0xc0000135`), while the Linux Docker build regenerated protobuf and passed.
- 2026-07-17 H7 closure: `5c03ce6` plus image baseline repair `3d885be` passed push runtime
  `29541564999`, PR runtime `29541566647`, PR Compose `29541566656` and PR quality
  `29541566648`. Both runtime runs executed complete `pnpm verify`; H7 is closed and H8 starts
  from the report-containing Head after its checks complete.
- 2026-07-17 H8 implementation: T-047 now starts from published rc.1 migrations 001-006 with
  admission/task/schedule/terminal/command/observation/outbox/idempotency fixtures, then proves
  007-012 backfills, idempotence and Recovery -> Dispatcher -> Scheduler continuation. T-048 and
  T-049 run 17 identical cases per Adapter and schema-guard three scopes: Adapter protocol
  passed, Runtime Profile partial and resource-specific safety not claimed.
- 2026-07-17 H8 closure: implementation `e1041a9` passed push runtime `29542809447`, PR runtime
  `29542810998`, PR Compose `29542811050` and PR quality `29542811006`. Local regression counts
  are unit 27, contract 4, rc.2 guards 6, integration 59, recovery 8, security 6 and E2E 4; both
  Adapters passed all 17 expanded cases. H8 closes without claiming real-resource safety or a
  complete standalone Runtime Profile.
- 2026-07-17 H9 implementation: release versions and deployment image move to rc.2;
  `verify:rc2` adds the six regression guards and CI compares Buf directly to the immutable rc.1
  tag. The expanded isolated-schema capacity gate exposed a real pool-max-one post-commit
  deadlock in four Task repository paths. All now reuse the checked-out client for visibility;
  the new lifecycle regression passes and integration grows to 60 tests. Local release evidence
  passes formatting/lint/type, audit/SBOM/deployment, unit 27, contract 4, guards 6, integration
  60, recovery 8, security 6, E2E 4, Adapter conformance 17/17 per language, expanded capacity,
  reproducible image, three-image Compose and Docker-hosted Buf lint/breaking.
- 2026-07-17 H9 release gate: implementation `70de271` passed push runtime `29544205005`, PR
  runtime `29544206323`, PR Compose `29544206369` and PR quality `29544206345`. PR #1 title/body
  now index the rc.2 scope and F-001..F-019 closure, but its immutable merged-ref rollup still
  contains formatting failures `29511142789` and `29511133163`. Deleting those failures or
  representing PR #4 checks as PR #1 checks would hide evidence. The final report is committed,
  but the rc.2 tag remains prohibited until this explicit release-governance condition is waived
  or replaced with an achievable continuation-PR criterion.
