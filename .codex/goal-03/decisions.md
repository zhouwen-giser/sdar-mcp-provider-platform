# Goal 03 Decisions

## G3-P2-B02 minimal state-machine scope exception

Recorded before implementation on 2026-07-29.

The task requires `DEGRADED -> DISCOVERING` recovery and forbids recovery from
skipping Catalog/Registry publication. The domain transition table currently
allows `DEGRADED -> ACTIVE` and rejects `DEGRADED -> DISCOVERING`, but
`packages/runtime-deployment/src/model.ts` is absent from the task's allowed
path list.

The minimum necessary exception is one transition-table change in
`packages/runtime-deployment/src/model.ts`: replace direct
`DEGRADED -> ACTIVE` with `DEGRADED -> DISCOVERING`. The task-authorized
property test will lock the new relation. The existing aggregate lifecycle test
in `packages/runtime-deployment/test/deployment.test.ts` must also replace its
old direct recovery step with `DEGRADED -> DISCOVERING -> ACTIVE` so the
mandatory full RuntimeDeployment gate reflects the same invariant. No
migration, persistence schema, protocol, API, infrastructure adapter,
scheduler, or production composition change is included.

## G3-P1-B02 final allowed paths

Recorded before implementation on 2026-07-29.

- `pnpm-workspace.yaml`: declare exact patched transitive resolutions for the
  two high-severity audit findings identified in B01.
- `pnpm-lock.yaml`: capture those resolutions reproducibly for frozen CI
  installation.
- `tests/tooling/audit-resolutions.test.mjs`: focused fail-closed regression
  that protects the minimum patched versions without changing the audit gate.
- `.codex/goal-03/**`: task state, decision, execution log, and evidence.

No `package.json` or workflow change is allowed because the command wiring and
CI environment reached the strict audit gate correctly. The focused tooling
test is the smallest task-card-authorized addition beyond the two B01
dependency files and records why that addition is necessary.

## G3-P1-B02 baseline-format exception

Recorded after the first full `verify:v2` rerun on 2026-07-29.

The dependency audit and all preceding frozen-protocol, runtime, and Business
Events gates passed, then `pnpm format:check` failed only on
`docs/review/GOAL03_BASELINE.md`, which was introduced by G3-P0-B01. The
minimum merge-readiness correction is a mechanical Prettier table alignment in
that file. No content, command, gate, protocol, migration, or runtime behavior
changes.

## G3-P1-B02 SBOM scope exception

Recorded after the second full `verify:v2` rerun on 2026-07-29.

The strict audit passed, then `pnpm sbom:check` correctly rejected the stale
dependency inventory. `reports/sbom/runtime-v1.cdx.json` must therefore be
regenerated from the patched lockfile. Its reviewed diff is limited to the
lockfile digest and `find-my-way` changing from `9.6.0` to `9.7.0`;
`brace-expansion` is not part of the production component set. No manual SBOM
content, gate, runtime, protocol, or migration change is included.
