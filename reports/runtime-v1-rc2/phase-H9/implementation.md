# Phase H9 Implementation Report

## 1. Goal

H9 implements the rc.2 aggregate release gate, versioned artifacts, expanded capacity evidence,
final documentation, PR scope update and delivery reporting. Functional and T-050 CI gates pass;
tag publication is blocked by the merged PR #1 historical rollup.

## 2. Baseline and upstream sync

- Starting SHA: `40089ddffd0d7bcc72d50023a37c98d7ab6d276b`
- `origin/main`: `2d5faa11de798ad09ab213d6cdf8f0073d169021`
- Target branch remote matched the starting SHA; seven commits ahead and zero behind main.
- No incoming conflicts occurred. The rc.1 tag object remained
  `9a4715e6316a23f399ee06eea2444b0245fa1adb`.

## 3. Implemented changes

- Bumped Runtime/workspace/Adapter/SBOM/deployment identity to `1.0.0-rc.2`.
- Added `verify:rc2`; CI runs it and compares Buf directly to `v1.0.0-rc.1`.
- Expanded capacity into an isolated-schema real PostgreSQL/gRPC gate.
- Fixed four post-commit PoolClient re-borrow deadlocks exposed by pool max 1.
- Added the T-001..T-050 executable matrix and updated every required release document.
- Updated merged PR #1 title/body with rc.2 scope and all finding closures.

## 4. State/transaction/protocol invariants

All external side effects retain durable intent, stable identity and replay/recovery boundaries.
The Task repository now reads post-commit visibility through the already checked-out client;
there is no second Pool borrow and no Adapter RPC under that client. Safe-stop Ack remains
distinct from terminal proof, Runtime observation revision remains independent, and historical
Tasks continue to resolve immutable snapshots.

## 5. Database migrations

No H9 schema change was required. Published 001-006 remain unchanged; T-047 proves 001-006 data
upgrades through append-only 007-012 and workers continue. The pool fix changes only access
patterns after `COMMIT`.

## 6. Tests executed

| Command/evidence                        | Result | Tests/detail                                            |
| --------------------------------------- | ------ | ------------------------------------------------------- |
| format/lint/type/audit/SBOM/deployment  | PASS   | 184 production components, 8 manifests                  |
| unit / contract / rc.2 guards           | PASS   | 27 / 4 / 6                                              |
| integration / recovery / security / E2E | PASS   | 60 / 8 / 6 / 4                                          |
| TypeScript / Python conformance         | PASS   | 17/17 each; scopes enforced                             |
| expanded capacity                       | PASS   | pool, dispatcher, scans, growth and image               |
| container / three-image Compose         | PASS   | reproducible non-root + Runtime/TS/Python builds        |
| Buf lint/breaking                       | PASS   | containerized 1.57.2 against immutable rc.1             |
| push/PR runtime and governance checks   | PASS   | `29544205005`,`29544206323`,`29544206369`,`29544206345` |

## 7. Defects found during implementation

The capacity gate found `publishAccepted`, `publishScheduled`, scheduled acceptance and
start-window compensation calling Pool-level `getById` after commit but before releasing their
client. A pool of one deadlocked despite the durable transaction having succeeded. The shared
client lookup and a two-second pool-one lifecycle regression close the defect.

## 8. Known limitations

- PR #1 is merged and its historical check rollup retains two old formatting failures. Current
  rc.2 PR #4 is green, but the histories cannot be conflated.
- Real-resource Adapter safe-stop qualification is not claimed.
- Runtime Streamable HTTP is deliberately stateless and does not support resumability or Task
  notifications.
- Local Windows grpc-tools cannot load; Linux Docker and remote CI provide build/proto evidence.

## 9. Changed files

Release scripts/workflows/versions, Task repository and regression, capacity/conformance/SBOM
reports, required protocol/operations/database/implementation docs, H9/final/blocker evidence.

## 10. Commit and push evidence

- Implementation commit: `70de271`
- Push: normal push to `origin/feature/mcp-tasks-provider-runtime-v1`
- CI: all current rc.2 implementation runs passed as listed above.

## 11. Exit criteria

- [x] All H9 implementation and regression requirements implemented.
- [x] T-001..T-050 executable tests pass without skip.
- [x] Traceability and final report are present.
- [x] PR #1 title/body updated to rc.2 scope.
- [ ] PR #1 historical check rollup all green.
- [ ] Annotated rc.2 tag created and pushed.
