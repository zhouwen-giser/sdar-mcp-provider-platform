# H4 Test Results

Executed on 2026-07-17 against the repository test stack and isolated PostgreSQL. No test was
skipped. Local final gate results and remote workflow ids are filled only from actual command
output; this file is updated by the closure commit after CI.

| Command                           | Result |        Tests | Notes                                                  |
| --------------------------------- | ------ | -----------: | ------------------------------------------------------ |
| `pnpm format:check`               | PASS   |          n/a | tracked text and generated protocol output             |
| `pnpm lint`                       | PASS   |          n/a | ESLint after H4 implementation                         |
| `pnpm typecheck`                  | PASS   |          n/a | TypeScript no-emit after H4 implementation             |
| `pnpm test:unit`                  | PASS   |           25 | six files                                              |
| `pnpm test:contract`              | PASS   |            4 | Adapter protocol contract                              |
| `pnpm test:integration`           | PASS   |           38 | real PostgreSQL/gRPC, including T-019..T-022           |
| `pnpm test:recovery`              | PASS   |            8 | includes Manifest v1-to-v2 T-017/T-018                 |
| `pnpm test:security`              | PASS   |            6 | authentication and limits                              |
| `pnpm test:e2e`                   | PASS   |            2 | real MCP HTTP stack                                    |
| `pnpm test:rc2:red`               | PASS   |            6 | all H0 structural guards now green                     |
| TypeScript Adapter image build    | PASS   |  image build | updated protobuf identity fields                       |
| Python Adapter image build        | PASS   |  image build | updated protobuf identity fields                       |
| first push runtime `29517410128`  | FAIL   |    Python P3 | Ack omitted external execution id; Runtime rejected it |
| first PR runtime `29517412904`    | FAIL   |    Python P3 | same reproducible conformance defect                   |
| repair push runtime `29517588173` | PASS   |    full gate | `pnpm verify`, Buf and Compose                         |
| repair PR runtime `29517591379`   | PASS   |    full gate | `pnpm verify`, Buf and Compose                         |
| repair PR quality `29517591502`   | PASS   | focused gate | repository quality workflow                            |
| repair PR Compose `29517591413`   | PASS   | focused gate | governance Compose workflow                            |

## Required matrix evidence

| Test  | Evidence                                                                            | Result |
| ----- | ----------------------------------------------------------------------------------- | ------ |
| T-017 | removed v2 operation; v1 admission recovery and scheduler use persisted snapshot    | PASS   |
| T-018 | old input uses v1 schema/capability; new call uses changed v2 schema                | PASS   |
| T-019 | Start task-id mismatch rejected before provider binding; admission uncertain        | PASS   |
| T-020 | Get mismatch leaves the entire Task row unchanged and appends an audit Outbox event | PASS   |
| T-021 | incorrect command/Ack sequence remains in durable retry state                       | PASS   |
| T-022 | Reconcile hash/context mismatch leaves Task unchanged; audited identity conflict    | PASS   |

The first aggregate invocation stopped before integration because its shell did not export
`TEST_DATABASE_URL`; the isolated PostgreSQL container was healthy, the variable was set, and
all database suites then ran. A later standalone E2E invocation made the same shell-scoping
mistake and was rerun with the required variable. These pre-test environment exits are retained
here and are not counted as passing test runs. The first lint pass after strengthening T-022 also
found one unsafe spread from an unknown generated Snapshot and one unsafe nested test matcher;
both were corrected before the clean final lint/type/test runs.

The initial full remote gate then found a separate Python Adapter mapping defect at P3 multi-round
input. Commit `5873a79` added the missing external execution id to the Ack identity. Both push and
PR full gates subsequently passed the TypeScript and Python conformance suites, generation drift,
Buf lint/compatibility, capacity baseline and Compose images.
