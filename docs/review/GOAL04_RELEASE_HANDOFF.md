# Platform 0.1.0 release handoff

## Release authority

- Manifest: `reports/platform-v0.1/RELEASE_MANIFEST.json`
- Evidence: `reports/platform-v0.1/TEST_EVIDENCE.json`
- Checksums: `reports/platform-v0.1/CHECKSUMS.sha256`
- SBOM: `reports/sbom/runtime-v1.cdx.json`
- Machine handoff: `.codex/handoff/platform-v0.1-final-handoff.json`
- Tested candidate: `349fb8339ead8760f158ac8b05ad8d01e4825199`

The historical Goal 2 and Goal 03 handoffs remain preserved, but they are not
release authority for Platform 0.1.0.

## Human and administrator actions

1. Confirm PR 4 targets `codex/goal-03-merge-readiness-foundation`.
2. Require the exact checks `static`, `runtime-ci`, `pms-api-production`,
   `worker-pm2-production`, `provider-regression`, `platform-e2e`, and
   `runtime-compose`.
3. Complete human review and repository-policy approvals.
4. Merge only when separately authorized; this Goal does not merge the PR,
   its parent PR, or `main`.
5. If a release is approved later, create its tag and record the tag plus
   resulting merge commit in GitHub Release metadata. Do not insert either SHA
   into a file contained by that same commit.

## Qualification boundary

The candidate is qualified on controlled local PostgreSQL, pinned PM2, built
Runtime and mock/controlled Provider resources. It is not external SDAR
certified and does not qualify real UGV, NPC Tank, ISR MQTT, Home Assistant or
physical climate resources.
