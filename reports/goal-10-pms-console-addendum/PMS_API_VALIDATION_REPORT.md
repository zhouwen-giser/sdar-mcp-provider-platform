# PMS API Validation Report

Status: **PASS**

Gate: **Gate C — PMS API validated**

Branch: `codex/goal-10-ugv-simulation-real-interface`

Addendum start HEAD: `c70d45ee117015db7571d8330025f8dc9096f3f5`

Qualification HEAD: `7ca09d55aaf01dab9d6711fdd793530084897868`

## Frozen contract

The frozen PMS Console API contract remains unchanged. Contract version `1.0.0` contains 36 operations, 28 component schemas, 15 examples, and 32 problem codes. The conformance gate completed with exit code 0 and matched all 36 frozen operations to all 36 registered operations, with no missing, extra, or duplicate operation.

| Artifact            | SHA-256                                                            | Result |
| ------------------- | ------------------------------------------------------------------ | ------ |
| OpenAPI             | `dddf9a6c9a5d8264b71aa11495106e197857e186b02fd8e54fc0f0a53e33f042` | PASS   |
| Schema bundle       | `a0982fd32dd5647831b528571fbee3972eac29ee0e8f7295b960e0507bf4ab1a` | PASS   |
| Endpoint source map | `1ebf9c52c29044a0c14d19d73841a1822559a1d1ddef72f4abe399569ff1a396` | PASS   |
| Error source map    | `3b72501425815462f7bbc11e5b080dc3baab3677bcea82d5701840d755ca2b6b` | PASS   |

## Executed validation

All commands below completed with exit code 0. PostgreSQL-backed commands used an isolated PostgreSQL 17 database; its connection value is intentionally omitted.

| Validation                      |             Files / tests | Result |
| ------------------------------- | ------------------------: | ------ |
| Full `@sdar/pms-api` test suite |                  32 / 132 | PASS   |
| `@sdar/pms-api` typecheck       |                         — | PASS   |
| `@sdar/pms-api` lint            |                         — | PASS   |
| `@sdar/pms-api` build           |                         — | PASS   |
| PMS Console conformance         | 36 frozen / 36 registered | PASS   |
| PMS API production composition  |                     1 / 4 | PASS   |
| PMS domain and persistence gate |                    5 / 23 | PASS   |
| PMS configuration gate          |                    3 / 16 | PASS   |
| PMS configuration E2E           |                     1 / 8 | PASS   |
| PMS migrations                  |                     2 / 9 | PASS   |
| Registry E2E                    |                     1 / 4 | PASS   |

The 36-row operation matrix is recorded in `PMS_API_OPERATION_MATRIX.json`. Every frozen operation had a successful Fastify injection case. All 36 also had an invalid-correlation negative case, and all 17 mutating operations had a missing-actor negative case. The tests additionally covered 202 RuntimeDeployment intent responses, a 204 empty response, and Registry ETag / If-None-Match / 304 behavior.

## Production composition

`createPmsApiComposition` was exercised against PostgreSQL 17. The production gate asserted nine applied migration rows and passed four integration tests covering:

- file-backed credential and authorization wiring, health, Runtime Config, and watch behavior;
- atomic RuntimeDeployment, reconcile-job, and Audit commit/rollback;
- Console RuntimeDeployment creation through the production Application, Job, and Audit path, including rollback;
- Runtime Registration persistence across composition recreation, optimistic concurrency, and freshness.

The supporting PostgreSQL gates passed empty-schema and repeat-safe migration behavior, existing-row upgrade preservation, Provider and Resource persistence, Configuration Draft/Validate/Preview/Publish/Rollback, RuntimeProcess queries, and Registry latest/history/diff/watch behavior.

## Negative and security validation

Executed HTTP cases rejected malformed JSON, an oversized body, invalid date-time, negative revision, empty identifier, additional property, unsupported content type, and `desiredReplicas=2`. Repository concurrency errors mapped to HTTP 409 with `OPTIMISTIC_CONCURRENCY_CONFLICT`.

The repair introduced the typed `ConsoleRequestMappingError` boundary. Only explicitly typed request-mapping failures are classified as client mapping errors. Unexpected `Error`, `TypeError`, and `RangeError` failures returned HTTP 500 with `INTERNAL_ERROR`, the fixed detail `An internal error occurred`, and no source error message disclosure. Exact assertions are listed in `PMS_API_ERROR_MATRIX.json`; that file does not claim unexecuted coverage for every member of the frozen 32-code enum.

## Legacy regression

Legacy `/api/v1/**`, Runtime Config, Runtime Registration, and health behavior passed. The dedicated regression test verified that the legacy not-found response retains the legacy envelope rather than Console `application/problem+json`. Runtime Config also passed its standalone PostgreSQL E2E suite (1 file, 8 tests); Runtime Registration was covered by the full package suite and production-composition recreation test.

## Scope and limitations

- Contract authentication remains deferred by the frozen contract; mutating Console operations require `X-Actor-ID` for audit attribution, but this validation does not redefine authentication semantics.
- Tests used isolated synthetic PMS data. They did not contact the real simulator and did not issue UGV movement, reconnaissance, gimbal, or effector commands.
- This report establishes PMS API Gate C only. Web, packaging, image-revision, and final-stack qualification are recorded separately.
- No database credential, token, Authorization value, simulator secret, or real endpoint is included in these evidence files.

PMS API validation result: **PASS**.
