# PMS Console API Contract V1 Frozen Handoff

Candidate 3 is frozen as PMS Console API Contract V1.0. It contains 36 locally grounded operations under the future `/api/console/v1` adapter and preserves Configuration, RuntimeDeployment, Registry ETag, audit, error and concurrency behavior without implementing routes or authentication.

The authoritative integrity record is `contracts/pms-console-api/v1/contract-lock.json`. The repository owner accepted only the precisely listed, pre-existing non-protocol findings in `FREEZE_EXCEPTIONS.json`; protocol and business non-impact gates all passed.

Consumers may use the frozen OpenAPI bundle, generated TypeScript declarations and standalone JSON Schemas as the V1 adapter contract baseline.
