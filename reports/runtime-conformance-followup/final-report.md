## Published Draft PR and CI evidence (2026-07-22)

- Draft PR: [#17](https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime/pull/17), `OPEN`, base `main`, head `fix/frozen-runtime-conformance-followup`.
- Implementation evidence commit: `1768a4f613685fc925757566df2351b9e9c0a861`.
- GitHub Actions Run: [29888399421](https://github.com/zhouwen-giser/sdar-mcp-tasks-provider-runtime/actions/runs/29888399421), attempt 1, `completed/success`.
- `runtime-ci`: `completed/success`, 2026-07-22T03:25:15Z through 2026-07-22T03:30:23Z; `pnpm verify:v2`, Buf lint, rc.1 compatibility, and artifact uploads all succeeded.
- `runtime-compose`: `completed/success`, 2026-07-22T03:25:15Z through 2026-07-22T03:26:12Z.
- Machine-readable evidence: `reports/runtime-conformance-followup/ci-run.json`.
- Delivery constraints remain satisfied: Draft only, no auto-merge, no tag.

## Authorized Climate protected-path exception (2026-07-22)

- The user explicitly authorized updating `reports/home-assistant-climate/provider-conformance.json` to resolve the inherited stale-report contradiction.
- The existing generator wrote the report without changing Provider implementation, Provider tests, or the generator.
- `pnpm protocol:ha-climate:check` now passes with 8/8 cases.
- Machine-readable authorization and verification evidence: `reports/runtime-conformance-followup/climate-protected-path-exception.json`.
