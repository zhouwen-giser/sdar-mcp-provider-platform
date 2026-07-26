# Runtime frozen conformance follow-up delivery

## Identity

- Base SHA: `8db97c7030f09b2a17c1821b80747f67ff885639`
- Base tree: `2d2097f7fa0eba88511f62493dc87ebfc3cf1916`
- Minimum required ancestor: `8db97c7030f09b2a17c1821b80747f67ff885639`
- Runtime version: `2.0.0-rc.1`
- Protocol version: `2026-07-28`
- Frozen contract SHA-256: `d33623f33ea2dfbb0ad56868d9911af6c7b37b354a0b17a76798646bded9a845`
- Implementation commit: `44eaab3c2e768c7acb789aad3eea7c429d7b35fa`
- Report commit: `40155670ce311cd8957d49fdb8977101f3f9a52f`
- CI run: pending Draft PR publication

## Machine-executed evidence

| Classification                       |                                       Result | Source                            |
| ------------------------------------ | -------------------------------------------: | --------------------------------- |
| Follow-up total                      |                                 29/29 passed | `test-execution.json`             |
| MRTR permanent rejection integration |                                   1/1 passed | `permanent-rejection.json`        |
| MRTR locked Schema unit/mock         |                                   4/4 passed | `atomic-schema-validation.json`   |
| MRTR real PostgreSQL concurrency     |                                   6/6 passed | `lock-order-concurrency.json`     |
| Notification configuration bounds    |                                   7/7 passed | `notification-config-bounds.json` |
| Notification metrics                 |                                   7/7 passed | `notification-metrics.json`       |
| Test-only red baseline               |                     25/29 failed as expected | `red-tests.json`                  |
| UUID index plan                      | provider_task and task_input_request indexed | `uuid-index-plan.json`            |
| Protected paths                      |                                    zero diff | `protected-paths.json`            |

Vitest JSON Reporter generated all test statuses. Unit/mock, real PostgreSQL integration, and real
PostgreSQL concurrency results are reported separately. The historical PR #15 report is retained
with a correction pointer.

## Verification status

The local V1.1 matrix passed: format, lint, typecheck, build, Proto drift, protocol lock, Frozen
74/74, Runtime Closure 29/29, Follow-up 29/29, PR #16 interop 19/19, unit 86/86, contract 9/9,
integration 199/199, recovery 9/9, security 29/29, E2E 6/6, Expanded Adapter Conformance,
Climate business 7/7, Climate Runtime E2E 1/1, component reports, capacity baseline, container
reproducibility, and `verify:v2`.

One inherited baseline gate remains unresolved: `protocol:ha-climate:check` reports the existing
`reports/home-assistant-climate/provider-conformance.json` as stale. The Provider source, tests,
report, and report generator are all zero diff from the required base, while the committed evidence
hashes do not match those base files. Updating either side is forbidden by this task's protected-path
policy. Remote CI and Draft PR publication are also pending.

Maximum permitted final claim after all remaining gates pass: **Runtime Component Conformant**.
No Interop Certified claim is made. No tag is created and no PR is automatically merged.
