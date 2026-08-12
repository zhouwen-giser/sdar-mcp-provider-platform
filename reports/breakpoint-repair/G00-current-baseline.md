# G00 Current Main Baseline Audit

## Source lock

- Repository: `zhouwen-giser/sdar-mcp-provider-platform`
- Main SHA: `cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef`
- Main commit: `Merge pull request #12 from zhouwen-giser/codex/goal-11-npc-tank-simulation-real-interface`
- Full environment metadata: `reports/breakpoint-repair/source-lock.json`

This audit distinguishes the locked `origin/main` baseline from repair code currently present in the
working tree. A working-tree implementation is not treated as fixed until the final candidate has
passed the repository verification gates.

## Baseline classifications

| Breakpoint  | Current-main classification | Delivery status         | Finding                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BP-SMPP-001 | `STILL_REPRODUCIBLE`        | `FIXED`                 | Main completed a Climate Task after the first matching observation. It did not require a stable duration or multiple observations, so a transient `off -> cool -> off` sequence could be committed as success. Exact candidate `23eb2ed1c14830a8a6b328d3a67df1badcd492ab` adds durable stable confirmation and passed the focused and full gates.                   |
| BP-SMPP-002 | `STILL_REPRODUCIBLE`        | `FIXED`                 | Main already persisted dispatch intent and did not blindly replay `INTENT_PERSISTED`/`CALL_RETURNED`, but an expired `NOT_STARTED` execution could still dispatch late and a matching observation could win after the deadline. The exact candidate's deadline-first recovery and persisted confirmation state passed deterministic recovery and full verification. |
| BP-SMPP-003 | `ALREADY_FIXED_ON_MAIN`     | `ALREADY_FIXED_ON_MAIN` | Climate and Light manifests advertise `cancel=false` and `pauseResume=false`; Adapter task-control RPCs return negative acknowledgements. A new contract test records this alignment and the absence of physical rollback.                                                                                                                                          |
| BP-SMPP-004 | `CONFIRMED_CURRENT`         | `PARTIALLY_FIXED`       | Main provides test-only hooks around intent persistence and the Home Assistant call, plus deterministic recovery tests. Coverage does not yet constitute the complete production recovery matrix requested by the Goal.                                                                                                                                             |
| BP-SMPP-005 | `CONFIRMED_CURRENT`         | `DEFERRED`              | The strict-intranet bundle is operationally coherent, but consumer access-profile facts are distributed across deployment configuration and documentation rather than exposed as one versioned consumer metadata contract.                                                                                                                                          |

## Code and contract observations

### Climate execution

The locked main implementation in
`apps/home-assistant-climate-provider/src/execution.ts` already had durable execution identity,
`dispatchState`, `sideEffectDispatched`, `confirmationDeadlineAt`, recovery, polling, and the
`afterDispatchIntentPersisted` / `afterHomeAssistantCall` test hooks. Its terminal decision still
used a single `confirmed(...)` result. Main did not persist a candidate stability window or a
matching-observation count.

The repair working tree adds a centralized confirmation policy and persists the baseline
observation, candidate start, matching count, last matching receipt time, and last observed state.
It also makes the deadline authoritative before dispatch, observation success, and recovered work.

### Recovery and side effects

Main's `NOT_STARTED`, `INTENT_PERSISTED`, and `CALL_RETURNED` markers are a useful at-most-once
foundation. Recovery does not repeat a Home Assistant call after the intent is durable. That
sub-capability is `ALREADY_FIXED_ON_MAIN`; BP-SMPP-002 remains open at the baseline level because
deadline ordering and stability-window continuation were incomplete.

### Task-control advertisement

`apps/home-assistant-climate-provider/src/manifest.ts` and
`apps/home-assistant-light-provider/src/manifest.ts` set both unsupported task-control flags to
false. The Adapter implementations reject cancel, pause, and resume without calling Home
Assistant. The frozen `TaskExecutionProfile` does not independently claim those controls. No
reverse physical operation is promised or performed.

### Consumer access profile

The production bundle selects `PMS_API_MANAGEMENT_AUTH_MODE=anonymous_intranet`,
`PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet`, Runtime `AUTH_MODE=anonymous`, the
`strict-intranet-plaintext` transport profile, and `direct_container` Runtime authority. PMS API
OpenAPI output can describe anonymous management operations. The frozen registry projection
contract and older Bearer-oriented contract tests do not provide a single DTO carrying auth mode,
transport mode, network scope, and consumer profile together.

## Scope boundaries

- No SDAR or organization-control-plane repository change is part of this repair.
- No real-device write gate is enabled by this audit or its deterministic tests.
- The native Registry, `sdar-registry-v1` DTO/checksum, lineage headers, and
  latest/304/bootstrap/watch semantics are not repair targets.
- BP-SMPP-004 and BP-SMPP-005 remain bounded so they do not delay the core stability and recovery
  correction.

## Verification boundary

This document preserves the baseline classification against source lock
`cc5dca8fab499826c8d1011e6f790e5fb0a8e3ef`. Final-candidate outcomes, the unchanged merged-main
SHA, and the exact verified candidate are recorded in `test-results.json` and `final-report.md`.
