# Phase R4 Test Results

| Command                         | Result    | Evidence                                                                                                                                           |
| ------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| format/lint/typecheck/build     | PASS      | strict local gates                                                                                                                                 |
| `pnpm test:unit`                | PASS      | 5 files, 20 tests including Availability contracts                                                                                                 |
| `pnpm test:contract`            | PASS      | 1 file, 4 tests                                                                                                                                    |
| focused real-socket integration | PASS      | 2 files, 2 tests                                                                                                                                   |
| PostgreSQL R4 integration       | PASS (CI) | run `29494627933`: batch Availability, unknown fallback, MCP method, sync/task duplicate, conflict, two-Runtime concurrency, restart and Reconcile |
| Compose smoke                   | PASS (CI) | run `29494627933`, both Adapter images and Runtime readiness                                                                                       |

The real PostgreSQL suite is mandatory and runs in GitHub Actions; absence of `TEST_DATABASE_URL` is not skipped locally.

Initial pushed run `29494518427` exposed that a NUL-delimited advisory-lock identity cannot be sent as PostgreSQL UTF-8 text. The lock identity now uses unambiguous canonical JSON array encoding before `hashtextextended`; its component binding is unchanged and no SQL constraint/test was weakened.

Corrected run `29494627933` passed all jobs.
