# Complete public-payload capture continuation, 2026-09-29

The probe now optionally emits a full validated Context and original parsed
selected notification; the qualification runner enables it. Default-output,
Task/source filtering, credential exclusion and chunk-digest checks pass.
UGV local regression: 18 files / 285 tests (`evidence/public-payload-local.log`).
The focused probe/manual suite passes 25 tests; whole-workspace typecheck and
changed-file ESLint pass (corresponding public-payload logs under evidence/).

A fresh full GOWM SMPP application-role installation supported the new real
navigation run: two adjustments, both processes restarted, no restart mutation,
final arrival 1.831354 m and speed zero. Full-payload replay passes 19 Contexts,
38 selected notifications and 38 duplicate no-ops. Four intentionally damaged
copies are rejected. See V-PUBLIC-PAYLOADS.md and the public-payload replay JSON
records. This did not change production Runtime/Provider code, install anything
on sz-gowm, or qualify V-OBS/V-INPUT/external SDAR.

The old navigation report/candidate and projection export remain historical
records. Missing original payloads in that report were not reconstructed. The
new source package and formatting checks are recorded with this continuation.

# Subsequent evidence and source audit, 2026-09-29

No production code changed in this continuation; all 65 candidate source hashes
still match. Six exported NDJSON files contain 559 actual navigation probe
records. Each output hash and the original report hash were verified; repeated
exact object versions were checked for consistency. See
`evidence/navigation-public-handoff/manifest.json` and `V-NAV.json`.

The active recon source audit observed mission 47567 running (status 5), anonymous
status/target messages and coverage run_id=1, then confirmed recon-specific stop
as status 9 with lock stage 1. No chassis/lock/fire call occurred. This is source
verification, not V-OBS or V-INPUT acceptance; both remain explicitly NOT_RUN.

Workspace formatting and git diff whitespace checks passed. Formatting output is
`evidence/handoff-format-check.log`. The package structure check remains
PACKAGE_OK for 22 tasks / 6 phases; it does not establish Goal completion.
The earlier source package was not rebuilt for these report/documentation edits.

# Final navigation continuation checks, 2026-09-29

| Check                                                       | Result                           | Evidence                                                                                                                                                |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real public navigation, two edits, OS restart, SSE recovery | PASS                             | evidence/navigation-public-restart.json                                                                                                                 |
| UGV local suite                                             | PASS: 18 files / 283 tests       | evidence/navigation-final-local.log                                                                                                                     |
| Last changed Runtime/trajectory/probe subset                | PASS: 109 tests (included above) | evidence/navigation-final-changed.log                                                                                                                   |
| Native PostgreSQL business/public wire                      | PASS: 2 files / 26 tests         | evidence/navigation-final-native.log                                                                                                                    |
| Complete selected GOWM Store and Runtime overlay            | PASS: 9 tests                    | evidence/navigation-final-gowm.log                                                                                                                      |
| Explicit owner deployment SQL                               | PASS: 7 tests                    | evidence/navigation-deployment-sql.log                                                                                                                  |
| UGV and NPC result-manifest compatibility                   | PASS: 15 tests                   | evidence/navigation-manifest-compat.log                                                                                                                 |
| Workspace typecheck and lint                                | PASS                             | evidence/navigation-final-typecheck.log; evidence/navigation-final-lint.log                                                                             |
| Build, frozen protocol, business/config generation, SBOM    | PASS                             | evidence/navigation-final-build.log; evidence/navigation-final-protocol.log; evidence/navigation-final-contract.log; evidence/navigation-final-sbom.log |
| Final workspace formatting/package archive                  | PASS                             | evidence/navigation-final-format.log; evidence/navigation-package.json                                                                                  |
| Hosted final CI / external SDAR / sz-gowm deployment        | NOT_RUN                          | FINAL_CLOSEOUT.md                                                                                                                                       |

Final public Task: `8a3d2d0b-5cf7-4e07-96a8-193b3cad6267`; missions
47564 → 47565 → 47566, effective revisions 1 → 2 → 3. JWT public MCP used the
production entrypoints on loopback and the real software simulator, with fire
false. Both processes restarted between commands; the physical mutation journal
was unchanged and 15 initial / 39 recovered-window SSE business events applied.
The final Task completed at 1.454523 m from the user goal, speed zero.

The source-only prevalidation and contract fixtures used a different disposable
installation and left deliberately unmapped Task events there. Final public
acceptance uses a fresh complete GOWM SMPP installation and preserves all failed
attempts; no event barriers or source histories were manually cleared. Source
state mapping failures in the earlier fixture are not counted as a pipeline pass.

The dense synthetic wire/precision fixtures explicitly use sampleEveryMs=0;
production retains the declared 1000 ms interval. A separate durable-sampling
regression verifies skipped intermediate samples, restart, mission changes and
gap splits. No assertion or physical freshness/adoption gate was relaxed.

The initial package check caught generated environment-template drift, then hit
sandbox child-process restrictions. The template was regenerated; the unchanged
package/SBOM commands completed with local execution permission. Full lint also
caught the deployment declaration file missing typed parser coverage, now fixed
in ESLint and tsconfig. Credentials are excluded from the temporary source package.
This is not a final united deployment release or a hosted CI result.

## Historical checks before this navigation continuation

# Current validation after running navigation replacement

The working candidate remains uncommitted and unqualified for release. The following
checks cover the latest implementation; earlier check history is retained below.

| Check                                                       | Result                         | Evidence                         |
| ----------------------------------------------------------- | ------------------------------ | -------------------------------- |
| Complete UGV local suite                                    | PASS: 17 files, 264 tests      | evidence/replan-final-local.log  |
| Runtime, navigation projection and command service subset   | PASS: 99 tests, included above | evidence/replan-subset.log       |
| Memory business Store                                       | PASS: 18 tests                 | evidence/replan-store.log        |
| Native PostgreSQL business persistence/submission           | PASS: 2 files, 25 tests        | evidence/replan-postgres.log     |
| Workspace typecheck                                         | PASS                           | evidence/replan-typecheck.log    |
| Changed TypeScript lint                                     | PASS                           | evidence/replan-eslint.log       |
| Workspace formatting                                        | PASS                           | evidence/replan-format-check.log |
| Real selected GOWM V-NAV/V-EDIT and Runtime process restart | NOT_RUN                        | V_REPLAN_SOURCE.md               |
| Hosted final CI / external SDAR                             | NOT_RUN / EXTERNAL_PENDING     | FINAL_CLOSEOUT.md                |

The disposable PostgreSQL instance was version 17.11 (Debian 17.11-1.pgdg13+2),
using a loopback port and tmpfs. It was removed after the tests. The new assertion
reads the complete hashed Intervention request from a fresh connection pool;
this does not qualify the selected GOWM installation or an operating-system process
restart. The seven new Runtime cases use controlled planner/telemetry fixtures.
No live device mutation, fire setting change, upstream repository edit, remote
schema installation or remote deployment was performed by this continuation.

## Earlier validation history, 2026-09-29

CANDIDATE.json records the current source/test hashes. This is an uncommitted
local worktree, not a released or deployed candidate.

| Check                                                                      | Outcome                                                                     | Evidence                                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Contract generation and Adapter protocol compatibility                     | PASS                                                                        | evidence/contract-check.log                                                                    |
| Expanded UGV local vertical suite                                          | PASS, 16 files / 248 tests                                                  | evidence/ugv-local.log                                                                         |
| Provider auto-lock and its manual-input continuation (subset of UGV-local) | PASS, 25 tests                                                              | evidence/ugv-local.log                                                                         |
| UGV Runtime regression (included in UGV-local)                             | PASS, 73 tests                                                              | evidence/ugv-local.log                                                                         |
| Additional legacy contract/reducer/query/auth/wire tests                   | PASS, 13 files / 87 tests                                                   | evidence/legacy-contracts-initial.log                                                          |
| Public source-to-Runtime business stream in disposable PostgreSQL 17.10    | PASS, 1 file / 2 tests                                                      | evidence/public-stream-postgres.log                                                            |
| Owner template plus fail-closed GOWM gate in disposable PostgreSQL 17.10   | PASS, 2 files / 9 tests; earlier component run, affected code unchanged     | evidence/gowm-template-component.log                                                           |
| Whole-workspace TypeScript noEmit                                          | PASS, exit 0                                                                | evidence/typecheck.log                                                                         |
| Targeted ESLint on changed TS                                              | PASS, exit 0                                                                | evidence/targeted-eslint.log; evidence/gowm-open-eslint.log; evidence/mission-fence-eslint.log |
| Selected-store and aggregate commands without required fixture             | PASS of missing-config guard, expected exit 2; no integration test executed | evidence/gowm-open-missing-env.log; evidence/verify-missing-env.log                            |
| Whole-workspace formatting                                                 | PASS                                                                        | evidence/format-check.log                                                                      |
| Selected complete GOWM strict-opener suite                                 | NOT_RUN, 8 test cases prepared; owner tables absent                         | PERSISTENCE_QUALIFICATION.md                                                                   |
| Full selected-store Runtime restart                                        | NOT_RUN                                                                     | PERSISTENCE_QUALIFICATION.md                                                                   |
| V-NAV / V-OBS / V-INPUT / V-EDIT                                           | NOT_RUN as same-candidate real Runtime workflows                            | EXTERNAL_BLOCKERS.json; FINAL_CLOSEOUT.md                                                      |
| External SDAR consumption                                                  | EXTERNAL_PENDING                                                            | SDAR_HANDOFF.md                                                                                |
| Hosted final-candidate CI                                                  | NOT_RUN                                                                     | tasks/BFF-021.md                                                                               |

The initial additional-contract invocation passed all 87 non-database tests but
failed collection of the public-stream suite because TEST_DATABASE_URL was
missing. Only that missing-environment suite was rerun, against a newly created
local PostgreSQL 17.10 container; both tests passed. That container used tmpfs,
was bound to loopback and was removed afterward. It was not the selected GOWM
installation. Earlier local socket restrictions were handled by rerunning with
local socket access; assertions and freshness gates were not weakened.

The expanded suite's 248 tests include the 25 auto-lock, 73 Runtime and 27
navigation/recon/footprint processor tests; these counts must not be added again.
Policy/input fixtures use synthetic telemetry and a mock device, not live source
qualification. The new eight-case GOWM suite is type-checked but has not run on a
complete owner installation. Fresh-pool rehydration is also narrower than a full
Runtime process restart. Legacy mapping associates all 48 UGVB tasks and 48
B/C assertions with code/tests; it does not claim every original assertion has
passed at every required layer.

The latest source audit is recorded in UPSTREAM_HANDOFF.md. A mission-switch
regression now verifies retirement of an unconfirmed prior-mission policy
request, immunity to stale coordinator invocations, and rejection of old
mission lock observations. It asserts logical request cancellation without
claiming physical release. The complete UGV-local command was rerun and all
248 tests passed.

## Existing planning and deployment SQL continuation

The updated UGV local command has 17 files / 255 unique tests. The initial sandbox run passed 247 and failed 8 only because HTTP/gRPC loopback listeners were denied. Rerunning the two affected files with loopback access passed all 11 tests in those files (including the 3 that had already passed); all 255 unique cases are now passing. Evidence: `existing-planner-local-initial.log` and `existing-planner-local-network.log`. The Runtime subset now has 75 tests and the planner subset has 5; do not add those counts again. These are component tests, not real acceptance.

The packaged GOWM SQL suite passed 5 tests on an isolated PostgreSQL 17.10 instance: read-only preflight, late-error rollback, strict overlay verifier under the app role, concurrent idempotent retries with least privileges, and checksum drift rejection. That temporary tmpfs container was removed. Evidence: `business-sql-deployment.log`. Complete GOWM strict-opener qualification remains NOT_RUN.

Workspace typecheck and targeted lint pass (`existing-planner-typecheck.log`, `existing-planner-eslint.log`). A temporary source archive was generated only for package validation; its SQL/checksum and deployment entrypoints were verified (`business-sql-package.json`). This is not a final united release, remote deployment or hosted CI pass. No fire configuration change or device movement was made.

The final adoption commit-boundary regression adds one case: a priority control arriving during Store reads defers adoption without writing a new route revision. The affected Runtime and navigation projection suites were rerun: 2 files / 81 tests PASS (`route-commit-fence.log`), bringing the current UGV-local unique case total to 256. Final workspace typecheck and targeted lint/format checks pass. Whole-workspace formatting also passed before this last formatted change; no hosted CI result is claimed.
