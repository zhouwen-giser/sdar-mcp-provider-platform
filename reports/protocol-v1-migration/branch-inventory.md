# Frozen Protocol V1 Branch Inventory

Observed: 2026-07-18 (Asia/Shanghai)

Repository: `zhouwen-giser/sdar-mcp-tasks-provider-runtime`

Commands executed:

```text
git fetch origin --tags --prune
git branch -r
git ls-remote --heads origin
gh pr list --state open
```

## A. Main

| Branch                               | Remote head                                | Classification         | Action                                     |
| ------------------------------------ | ------------------------------------------ | ---------------------- | ------------------------------------------ |
| `main`                               | `d55d64649b7a1cd53197ea393e7af0bb07eabfff` | current protected main | migration source                           |
| `feature/sep2663-frozen-protocol-v1` | `45bbffd6600c5d500254e949bcbb00c3fbbaf60e` | Runtime migration      | update Draft PR #13 and rerun protected CI |

The migration branch was created directly from the observed remote `main`; no Provider commits are
included.

## B. Active Provider branches

| Branch                                    | Head                                       | PR                                                                              | State                                 | Migration action                                                                        |
| ----------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- |
| `feature/home-assistant-light-provider`   | `f33edb844bbb580fdeb3afc68b840f6a69dfb724` | [#12](https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime/pull/12) | Draft, checks green at inventory time | wait for Runtime migration merge, merge `origin/main`, update the existing PR           |
| `feature/home-assistant-climate-provider` | `8a4721478695fba477c0e1906ba8ae5cfcda7649` | none; local only                                                                | unpublished local Provider work       | preserve; after Runtime migration merge, merge the new `origin/main` before publication |

No other open Provider PR was present. Provider Wire Contract work is intentionally deferred until
the Runtime migration PR has merged.

## C. Mock Adapters

The TypeScript and Python reference Adapters exist on `main`, not on independent active branches.
They migrate with the Runtime branch.

## D. Historical, merged, release, and governance branches

The following remote branches correspond to merged PRs, historical release work, or repository
governance and must not be changed by this migration:

- `agent/docs-external-interface-reference` (merged PR #11)
- `codex` (merged PR #2)
- `feature/mcp-tasks-provider-runtime-v1` (merged PRs #1 and #3-#7)
- `feature/runtime-v1.1-telemetry` (merged PR #9)
- `fix/runtime-v1.1-telemetry-completion` (merged PR #10)
- `release/1.0.0-rc.3` (merged PR #8 and historical release evidence)
- tags `v1.0.0-rc.1` and `v1.0.0-rc.2`

No branch was rebased, force-pushed, deleted, or otherwise rewritten during inventory.

## Contract source finding

The current referenced attachment remains the 35,884-byte migration task package with SHA-256
`7c27e62e43f0358f3a50718caac4c73001cbc807d5eb2521fced794c81db8ff6`. Its requirements are now
audited separately from the product contract.

The earlier source-byte blocker is resolved. The user supplied
`D:\downloads\SDAR_MCP_Tasks_Unified_Protocol_Profile_V1.0_FROZEN.md`, and the byte-preserving
repository copy is locked at SHA-256
`d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`. The pinned MCP commit,
schema Git blob and protocol lock remain unchanged.

The refreshed remote inventory found no additional open Provider PR. The local-only
`feature/home-assistant-climate-provider` branch still exists and must remain unpublished until the
Runtime migration is normally merged, after which both Provider branches must merge the new
`origin/main` without rebase or force-push.
