# Runtime rc.2 Baseline Assessment

Date: 2026-07-16  
Baseline worktree commit: `51d68926ba1bc9e935438e750582693aea3ecf4d`

## Repository and release truth

`git fetch origin --tags --prune` completed successfully before repository inspection. Local
branch, target remote branch and PR #1 Head are identical. PR #1 is OPEN, ready, based on
`main`, merge state CLEAN. The annotated rc.1 tag has tag object `9a4715e6...` and peels to the
same `51d6892...` commit. No tag was modified. `origin/main` is the exact merge base; the target
branch is 25 commits ahead and 0 behind.

The only pre-existing worktree item was the user-supplied untracked rc.2 task package. Its 13
declared SHA256 values all match. It is intentionally preserved as H0 input.

## Reviewed implementation

The assessment covered the task package/references, rc.1 ExecPlan, migrations 001-006,
Operation Snapshot repository, Task Engine, Scheduler, Recovery Manager, MCP handler, gRPC
gateway/types, PostgreSQL Task repository, unit/contract/integration/recovery/security/E2E
tests, conformance reports and rc.1 final delivery report.

Confirmed red defects:

- cancel and deadline RPCs execute in request/scheduler paths; Ack rejection leaves STOPPING;
- `withRecoveryLock` holds a PostgreSQL client and advisory transaction across Reconcile and
  command replay RPCs;
- no immediate watchdog; accepted queued/scheduled Snapshot always sets actual start time;
- retryable scheduled rejection is terminalized; window/rejection transitions omit
  Observation/Outbox;
- Task observation primary revision is directly coupled to Adapter revision;
- Scheduler/Recovery/control resolution uses current Manifest instead of stored Snapshot;
- Snapshot/external ID/context and Ack command sequence are not centrally validated;
- TTL has no expiry/cleaner, tasks/get has no transient stale fallback, MCP errors are generic,
  and output schema is not enforced on results.

## Unmodified baseline commands

| Command                          | Exit | Duration | Result                                                                 |
| -------------------------------- | ---: | -------: | ---------------------------------------------------------------------- |
| `corepack enable`                |    0 |    0.26s | PASS                                                                   |
| `pnpm install --frozen-lockfile` |    0 |   36.04s | PASS, pnpm 11.13.1                                                     |
| `pnpm format:check`              |    1 |    3.66s | CRLF checkout reported 173 files; no content failure isolated          |
| `pnpm lint`                      |    0 |    8.92s | PASS                                                                   |
| `pnpm typecheck`                 |    0 |    3.77s | PASS                                                                   |
| `pnpm build`                     |    1 |    1.54s | native grpc-tools command failed after removing generated output       |
| `pnpm test:unit`                 |    0 |    4.13s | PASS, 24/24                                                            |
| `pnpm test:contract`             |    1 |    1.90s | 2/4 PASS; generated output absent and Windows `python3` alias unusable |
| `pnpm verify`                    |    1 |    3.36s | stopped truthfully at format gate                                      |

The generated-file deletions caused by the failed build were restored from the exact HEAD diff;
they are not user changes. H0 adds portable Prettier line-ending handling. Linux/Docker/
PostgreSQL/Python verification remains mandatory in CI and later release gates.

## H0 red tests

`tests/rc2/rc1-red-regressions.test.ts` defines six stable expected-red guards matching the task
package's mandatory reproductions. They run only through `pnpm test:rc2:red` during H0; normal
CI remains capable of compiling the branch. H1-H4 must turn these guards green and add their
required PostgreSQL/gRPC/wire counterparts before the guards can count as closure evidence.

## Baseline limitations carried forward

The rc.1 final report's “no remaining implementation TODOs” statement is superseded by the
review findings and this code-backed assessment. Reference Adapter conformance proves protocol
examples, not real-resource safety qualification. Capacity is sequential/resource-free and not
a production SLO.
