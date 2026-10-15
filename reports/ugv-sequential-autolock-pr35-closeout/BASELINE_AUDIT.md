# PR #35 sequential AutoLock closeout baseline

Observed on 2026-10-08. Scope: issues ② (serial distinct-target AutoLock) and ⑥
(reviewable PR with immutable raw-evidence archive). This is an engineering
verification; it does not grant real-device multi-target qualification.

## Authoritative state

- Initial local HEAD: `9f6714d1fc06a65fb7438d66df435da51226455a` on
  `codex/smpp-gowm-shared-storage-integration-v0.1`; index and worktree were clean.
- Remote PR [#35](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/35)
  is open, not draft, unmerged and mergeable. Its head is
  `6a6db44c865a85503548ca9ada0ce4dc69864e9f`.
- The local branch was strictly four commits behind the remote (zero local-only
  commits). `git merge --ff-only --no-stat` preserved all existing work and
  advanced it to `6a6db44`. No reset, clean, stash or force push was used.
- Remote main: `5a2482aa5df25f2eebed604ed15f9d4c3a02a454`.
- Archive branch `archive/ugv-pr35-raw-evidence-20261008` points to the pinned
  commit `9f6714d1fc06a65fb7438d66df435da51226455a`; its objects are available locally.
- PR diff at this baseline: 364 files, +33,549 / -685 lines.
- [CI run 37716695758](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/37716695758)
  completed successfully for exactly `6a6db44`; `static`, `development-tests`
  and `task-business-ugv` all succeeded. This evidence does not certify a later commit.

## Reuse and remaining verification

| Item                                 | Classification | Evidence / next action                                                                                                                                                         |
| ------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Serial target policy                 | PREEXISTING    | `ProviderAutoLockCoordinator` uses `ugv.sequential-visible-target/1`, persisted Mission Action history and deterministic per-target mutation steps. Audit all A-01–A-14 edges. |
| Native confirmation and decisions    | PREEXISTING    | Runtime, NativeLock and RequiredInput tests exist; inspect release, recovery, control races and actual wire bindings.                                                          |
| Archive reference and manifest       | PREEXISTING    | Fixed archive branch and 20-entry manifest exist. Run byte/SHA audit and compare manifest set with the original large captures.                                                |
| Existing candidate CI                | VERIFIED       | All three key jobs succeeded for the exact baseline SHA.                                                                                                                       |
| Final reports / Goal state           | CHANGE_NEEDED  | This closeout report directory was absent; Goal tasks were still `TODO_VERIFY`.                                                                                                |
| Real-source sequential qualification | OUT_OF_SCOPE   | Synthetic coverage must not rewrite historical V-OBS/V-INPUT or Map-full outcomes.                                                                                             |
| PR merge                             | OUT_OF_SCOPE   | Recommend squash merge after closeout; do not merge without separate explicit user authorization.                                                                              |

## Local debugging endpoint

The user authorized local container code updates for debugging at port 19100.
Read-only inspection maps it to `smpp-gowm-runtime-1`; Runtime and Adapter images
are based on `0a4a7c36865d4c9920a4e65857c0903e9ef12533`. Runtime uses
`AUTH_MODE=development`; Adapter uses `UGV_EXECUTION_MODE=live` and
`UGV_FIRE_ENABLED=false`. These containers bind the existing GOWM installation.
This audit uses isolated tests and a temporary database; local read-only health
checks may be recorded separately. No field navigation, Recon or lock operation
is authorized by this Goal.
