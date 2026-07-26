# v1.0.0-rc.3 Final Delivery Report

Date: 2026-07-17

Release branch: `release/1.0.0-rc.3`

Verified implementation commit: `19c818feadf6df7e16250279a14650e56c35ac24`

## Outcome

H0 through H10 are implemented in order with dedicated phase commits. This release adds no
product features. Published rc.2 migrations and `reports/runtime-v1-rc2/` remain unchanged.

The aggregate `pnpm verify:rc3` gate passed in 287.4 seconds. Migration upgrade, two-replica race
tests, security, E2E, conformance, images and release capacity all passed. The regenerated
capacity report records:

- 1,000 concurrent Task admissions across a two-replica topology;
- 15,000 ms Adapter response delay with a 0.931 ms database query during the RPC;
- 500/500 durable commands acknowledged with zero duplicate Adapter side effects;
- 16/16 overdue bound executions receiving durable `START_WINDOW_MISSED` safe-stop intent;
- recovery scans returning 100/500/1,000 candidates without starvation;
- positive bounded Observation/Outbox growth and a reproducible non-root image.

## Governance

Branch protection now requires `runtime-ci` and `runtime-compose`; obsolete `quality` and
`compose-smoke` workflows were removed. Version surfaces, Kubernetes image, metrics, server info,
SBOM, migration/upgrade docs and operations docs identify rc.3. The published
`v1.0.0-rc.2` tag and its `013_single_claimed_command.sql` migration were not moved or rewritten;
the rc.3-only claim consistency constraint is appended as migration 016.

PR #8 is the publication vehicle for this branch and conflict-resolution evidence. The rc.3 tag
is outside this goal and must not be created until the protected PR checks pass.
