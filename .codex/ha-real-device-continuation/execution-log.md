# SMPP Home Assistant real-device preparation continuation

## 2026-08-03 Asia/Shanghai

- C0 started from the protected local candidate lineage.
- Verified worktree clean, branch `codex/ha-real-device-preparation`, current HEAD `6d738a0727d02e865548753bde4373ce4d04fc13`, previous candidate ancestor `cd68a91d129ba50a240837c79526ebdfdfbfa05c`, and `origin/main`/base `abd9db778848303d2966ac9b9e80f75207713109`.
- No reset, discard, merge, tag, release, public deployment, or SDAR Agent Runtime integration was performed.
- Evidence classification inherited from the previous run; all seven continuation blockers remain open until separately closed with current evidence.

## C1 protocol runner correction

- Removed the obsolete terminal-method call from the Climate and Light real runners.
- Updated the three-device aggregator to require terminal `tasks/get` projections from component reports.
- Updated current Runtime API, recovery, and authority documentation; frozen protocol source and negative conformance coverage remain unchanged.
- Added `reports/real-device-preparation-continuation/protocol-method-inventory.json` and `protocol-runner-correction.md`.
- Focused regression: `vitest run tests/unit/real-device-runner-protocol.test.ts` passed 2/2.
- Closed blocker: `REAL_RUNNER_EXPECTS_REMOVED_TASKS_RESULT` / inherited `FROZEN_MCP_TASKS_RESULT_UNSUPPORTED`.

## C2 cross-platform gates

- Before evidence: 38 locked files, 32 line-ending-only mismatches, 0 content mismatches under Windows `core.autocrlf=true`.
- Added LF attributes for `proto/**` and `protocol/**/*.json`, materialized the affected tracked text files as LF, and left `protocol/protocol-baseline.lock.json` unchanged.
- Windows and Linux `node:22-bookworm` both verified the unchanged protocol lock: 38/38.
- Linux dedicated symlink gate passed against the compiled Provider Package Registry implementation with `PACKAGE_ENTRY_SYMLINK_REJECTED`.
- Full Vitest under Linux was not claimed because the mounted Windows dependency tree lacks Linux optional native bindings; the dedicated gate is the current evidence for this OS-specific security branch.

## Evidence policy

- `real`: executed against the configured Home Assistant resources.
- `controlledFaultInjection`: executed only through explicit test failpoints and safety gates.
- `contract`: fake/contract/PMS platform evidence.
- `static`: source, schema, package, or report inspection.
- `unverified`: not sufficient for readiness.

## C3-C5 live PMS and Registry evidence

- Formal PMS API onboarding confirmed both Provider Packages, Provider Types, Providers, three Resources, bindings, published configuration revision 1, and both Runtime Deployments.
- Both live Deployments reached `ACTIVE` and both Runtime `/health/ready` endpoints returned ready after controlled local release asset preparation.
- Catalog revision 1 for each Provider and Registry revision 3 were observed through the live PMS API. `latest` and `bootstrap` returned the same checksum and ETag; the redacted Registry contained no Secret or Entity ID keys.
- Historical pre-repair evidence: the separately launched Worker claimed three existing reconcile jobs and renewed their leases without completion. The Worker gate was later closed by the fresh post-repair formal run recorded below.

## C6-C8 real Registry E2E and recovery

- Historical pre-runner-correction evidence: the frozen Runtime returned 404 for `initialize`. The runner was later corrected to use the frozen `server/discover`, `tools/list`, and `tools/call` surface, with `initialize` recorded as not applicable.
- Both lights completed bounded `light_set_power` toggles and restorations through the PMS Registry-backed Light Runtime. Same-argument duplicate Task IDs were reused and conflicting arguments returned HTTP 400. Final light states matched the saved originals; active and uncertain counts were zero.
- Stopping the Light Adapter caused Runtime readiness 503 and gRPC connection failures. Restarting the Adapter alone did not recover the existing Runtime client; an exact Light Runtime restart restored readiness. In-flight restart recovery remains unverified.
- Climate writes were stopped because the saved climate power was off and the five-minute inverse-power protection would make a safe restoration impossible. No climate side effect was attempted in this continuation.

## C10 full regression

- Offline frozen-lockfile dependency rebuild passed with pnpm 11.13.1 after the Windows pnpm dependency-status path reproduced node_modules EPERM.
- Direct lint, typecheck, build, frozen protocol checks, generated self-check, unit (127/127), contract (18/18), security (42/42), protocol-conformance (73/73), focused Home Assistant suites, and focused PMS Home Assistant platform tests passed.
- Repository-wide Prettier remains blocked by two pre-existing files: `docs/protocol/mcp-runtime.md` and `reports/real-device-preparation/authority-map.md`.
- Full integration was partial (211 passed, 7 existing NPC Tank failures) and full E2E was partial (7 passed, 1 existing NPC Tank failure) because fixed `D:/tmp/npc-tank-*.json` paths return Windows EPERM.
- Provider Package symlink security test remains blocked by Windows EPERM, including elevated rerun; the dedicated Linux symlink gate remains the valid OS-specific evidence.
- `verify:v2` and `verify:platform` aggregate wrappers remain unverified; direct component gates are recorded in `reports/real-device-preparation-continuation/full-regression.json`.
- A later read-only Home Assistant preflight was run twice and failed both times with `ENTITY_UNAVAILABLE` for the auxiliary light. No write was attempted after this state change; the current handoff therefore remains blocked.

## C3/C6 continuation recheck

- 2026-08-03 11:15-11:25 Asia/Shanghai: a fresh formal PMS Worker run initially reproduced the Windows PM2 client lifecycle failure. The minimum repair serializes `Pm2ProcessManager` operations, reuses one PM2 connection, and disconnects only from Runtime composition shutdown; focused PM2 tests passed 12/12, TypeScript/ESLint/Prettier passed, and two concurrent live PM2 `list` calls passed 2/2.
- After moving the stale local PM2 control root to a recoverable ignored backup and starting a clean root, the formal Worker completed repeated `runtime_deployment.reconcile` jobs for both `ha-climate-lab` and `ha-light-lab`. Both Deployments were `ACTIVE`, ready, and listening on their Registry endpoints; latest observed revisions were 22 and 40. The current `pms-worker.err.log` has no entries newer than the earlier failed run.
- 2026-08-03 11:24 Asia/Shanghai: Registry-backed real MCP read E2E used the live `latest`/`bootstrap` Registry, verified checksum/ETag equality and both Provider records, then completed `server/discover`, `tools/list`, and `tools/call` state reads for all three configured resources. Protocol qualification passed; the run is `blocked_resource_unavailable` solely because the auxiliary light returned `reachable=false`/`unavailable`.
- 2026-08-03 11:32 Asia/Shanghai: read-only HA WebSocket diagnostics found all three configured entities present in the entity registry, not disabled or hidden, and the `xiaomi_home` config entry loaded. The auxiliary light remains unavailable at HA state authority; no write was attempted.

## Current HA availability diagnosis and Registry contract

- 2026-08-03 12:29-12:35 Asia/Shanghai: HA error-log inspection found repeated `xiaomi_home` MIoT session disconnect/reconnect messages without an invalid-token indication. The config entry remained `loaded` and the entities remained enabled; the auxiliary light stayed `unavailable`.
- A fixed Home Assistant `reload_config_entry` management call succeeded without invoking any device-domain service, but the auxiliary light remained unavailable. One controlled restart of the local `homeassistant` container also left the auxiliary light unavailable; climate and main light returned to their prior readable `off` states, and both SMPP Runtime readiness endpoints returned HTTP 200.
- 2026-08-03 12:39 Asia/Shanghai: live Registry contract probe passed `latest`, `bootstrap`, monotonic `history`, `diff`, ETag/If-None-Match 304, initial `watch` event, checksum, provider count, and sensitive-field checks. The Registry-backed MCP read E2E remains blocked only by the current auxiliary-light resource state.

## Controlled fault-injection tests

- `tests/fault-injection/platform-faults.test.ts` passed 4/4: PMS LKG during outage, Adapter readiness separation, bounded Runtime crash recovery, and migration database failure closed with redacted evidence.
- Home Assistant Provider security coverage passed for the selected climate/light files. These are controlled/contract evidence and do not close real in-flight restart or REST-200-without-state-change blockers.

## Final narrow verification

- 2026-08-03 11:57 Asia/Shanghai: direct local binaries passed the changed-scope PM2 test (12/12), Prettier checks, ESLint, and TypeScript typecheck. The pnpm wrapper was not used for these results because its dependency-status phase reproduced the known Windows node_modules EPERM/no-TTY failure.
- The report scan over all changed `.codex` and `reports` files found zero configured Home Assistant Entity ID occurrences, zero token occurrences, and zero Authorization Header occurrences.
