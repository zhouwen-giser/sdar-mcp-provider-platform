# Goal 05 release qualification baseline

## Immutable starting point

- Repository: `zhouwen-giser/sdar-mcp-provider-platform`
- Base and work-branch starting commit: `8af9b76086eebc8b6e516cda4ca29068dc4d5ef7`
- Work branch: `codex/goal-05-release-qualification`
- Target release: `platform-v0.1.0`
- Runtime component remains `2.0.0-rc.1`
- Baseline observed by the task package and the fetched `origin/main` are identical.
- No `platform-v0.1.0` Git tag exists after fetching remote tags.

This commit is only the release-qualification baseline. It is not a qualified release candidate.

## Prior green evidence

GitHub Actions run
[`30429769986`](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/30429769986)
completed successfully. Its pull-request merge SHA is
`d5e6168d92ff03dda63d2492a65c20a1cd2a391a`; the last product-code commit identified by
the review is `d4c3c53cf28e5b5e31b7d0821ab3aab9c9b10f11`.

The seven preserved jobs were all successful:

| Job |
| --- |
| `static` |
| `runtime-ci` |
| `pms-api-production` |
| `worker-pm2-production` |
| `provider-regression` |
| `platform-e2e` |
| `runtime-compose` |

That historical success is evidence for the earlier candidate only. Goal 05 must run qualification
again against one new immutable source commit.

## Protected prior state

The captured baseline contains all seven files required by
`capture_prior_goal_state.py`:

| Protected file | SHA-256 |
| --- | --- |
| `.codex/task-state.json` | `5ffce4a73146dd9c8a7d7ffd299fb9298d2c461355946120019a36d6ce4378be` |
| `.codex/handoff/goal2-handoff.json` | `c93f9fc6da11e8e359d77db45329a763468990607b0d2a578f8e71549319c6a2` |
| `.codex/goal-03/task-state.json` | `97655383f319a93b51071872b0dfa39c8612b5fda6b2dad661d12c7f1853afcf` |
| `.codex/goal-03/handoff.json` | `10179891284cf6695739bce4622dcdae18cc10e280126f7a88d4c6e624bb632d` |
| `.codex/goal-04/task-state.json` | `40dcece201b696657745621e883df1fca514c51e45da710ce3515c2559878cac` |
| `.codex/goal-04/handoff.json` | `47acaf1bcd8d67e76ad53d90a40d565fae670b4148249474034df7104cf76313` |
| `.codex/handoff/platform-v0.1-final-handoff.json` | `3c434d01fdfe5e207a6fe96253b72a4b169befaeae873e872ee7dc560de07311` |

`verify_prior_goal_states_unchanged.py` passes at this baseline. These files remain historical and
must not be rewritten by Goal 05.

## Release-authority defect

`RELEASE_MANIFEST.json`, `TEST_EVIDENCE.json`, and the final platform handoff all name
`349fb8339ead8760f158ac8b05ad8d01e4825199`. That commit predates the last fully green code
candidate. The manifest currently sets `releaseAuthority` to `true`, but this authority is
invalid and is explicitly recorded as **PENDING REBIND**. It is not accepted as qualified evidence.
