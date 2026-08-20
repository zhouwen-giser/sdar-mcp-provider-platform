# UGV Provider Template Stabilization — Final Report

## Outcome

Classification: **UGV_PROVIDER_TEMPLATE_READY_LIVE_VALIDATION_PENDING**

Fixes A–D and the integration/regression gates pass. The one controlled physical point-navigation validation remains pending because the required explicit LIVE authorization was not supplied. No real mutation was executed by this goal run.

## Source and target

- Repository: `zhouwen-giser/sdar-mcp-provider-platform`
- Source branch: `codex/ugv-provider-pre-simulator-hardening`
- Reviewed source SHA: `a241985f652894a70d41340d88029c2be8dd8290`
- Target branch: `codex/ugv-provider-template-stabilization`
- Evidence head before this self-referential finalization commit: `9d7039291cdbb1bbeae7b660a812c9e1b8f9a732`
- Finalization commit: the commit containing this report, with message `docs(ugv): finalize provider template stabilization`; its concrete SHA is reported in the final handoff because a commit cannot contain its own hash.
- Remote push performed: `false`

## Fix status

- Fix A — **PASS**: one operation-profile and qualification authority; undeclared outputs require Runtime validation; result policies distinguish accepted, rejected and uncertain; all consumers share exact diagnostics.
- Fix B — **PASS**: durable mutation phases, multi-step dispatch fences, persisted deadlines/orphan state and deterministic no-replay recovery.
- Fix C — **PASS**: field-level observation authority, compatible geodetic/local displacement, continuous stationary proof, correlation/conflict governance and bounded control confirmation.
- Fix D — **PASS**: separated E-Stop phases, durable preemption/external occupancy, stable public DTOs, exact variant health, device-independent startup and an isolated development Compose template.

## Tests and integration boundaries

- Full `pnpm verify:ugv-provider`: **PASS** — unit 10, contract 7, integration 55, security 3, gRPC E2E 2, plus format/lint/typecheck/build/generated checks.
- Full `pnpm verify:npc-tank-provider`: **PASS** — unit 16, contract 7, integration 23, security 4, gRPC E2E 1, plus format/lint/typecheck/build/generated checks.
- Affected aggregate: **14 files / 106 tests PASS**. The dedicated local preflight Node suite passed 2/2.
- UGV/NPC provider-platform Catalog and Registry publication: **3/3 and 2/2 PASS**.
- RuntimeDeployment 58/58, Database Provisioner 21/21, Registry 17/17, PMS 25/25, PMS migrations 9/9, recovery 9/9, and database isolation 1/1: **PASS**.
- PM2 Runtime Adapter: **51 PASS / 1 Windows-only skip** on Linux.
- Frozen protocol: **74 cases and 44 locked files PASS**.
- Runtime MCP/Adapter protocol, PMS, separate Provider/Runtime databases, Database Provisioner and PM2 process/config boundaries remain intact. No synchronous PMS startup dependency was introduced.

## Development and external evidence

- Mock profile: seven isolated services started and `REAL_RUNTIME_READ_ONLY_READY` completed four read-only operations through `http://127.0.0.1:19120/mcp`; mutating calls: 0.
- External preflight: Device MCP connected with 15 tools; MQTT connected in passive-subscribe-only mode; no publish or control call occurred. Status is `PASS_WITH_UPSTREAM_DRIFT` for the optional tool and QoS differences listed in `KNOWN_LIMITATIONS.md`.
- Controlled LIVE runner: `BLOCKED_BEFORE_DISPATCH`, reason `ALLOW_REAL_UGV_SIDE_EFFECTS_REQUIRED`, mutating calls 0, previous rejected idempotency key not reused. Gate L disposition is **NOT_AUTHORIZED**.

## Reports, commits, delivery and worktree

- Required machine-readable reports and the LIVE evidence are in this directory.
- Ordered atomic commits are in `COMMIT_LIST.json`; observed and resolved regression failures are disclosed in `REGRESSION.json`.
- Delivery ZIP, SHA-256 sidecar and binary patch are generated under `delivery/` from the Git index, excluding secrets, build outputs and unrelated working-tree content.
- At finalization, the only unrelated working-tree modification is the preserved user-owned `reports/ugv-simulation/READ_ONLY_SMOKE.json`; it is intentionally not staged or delivered.
