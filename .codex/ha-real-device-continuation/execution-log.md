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
- The separately launched Worker claimed three existing reconcile jobs and renewed their leases without completion. Direct application reconcile evidence is kept separate and does not close the Worker gate.

## C6-C8 real Registry E2E and recovery

- Registry-backed read-only MCP calls queried all three configured resources. The frozen Runtime returned 404 for `initialize`; this is recorded as `MCP_INITIALIZE_NOT_SUPPORTED_BY_FROZEN_RUNTIME`, not converted into a pass.
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
