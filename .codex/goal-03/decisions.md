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
