# H8 Test Results

Executed 2026-07-17 against PostgreSQL 17 and real TypeScript/Python gRPC Adapter processes. No
test was skipped.

| Command / evidence              | Result | Count or detail                                 |
| ------------------------------- | ------ | ----------------------------------------------- |
| format, lint, typecheck         | PASS   | all H8 sources                                  |
| `pnpm test:unit`                | PASS   | 27                                              |
| `pnpm test:contract`            | PASS   | 4                                               |
| `pnpm test:rc2:red`             | PASS   | 6                                               |
| `pnpm test:integration`         | PASS   | 59                                              |
| `pnpm test:recovery`            | PASS   | 8                                               |
| `pnpm test:security`            | PASS   | 6                                               |
| `pnpm test:e2e`                 | PASS   | 4                                               |
| TypeScript expanded conformance | PASS   | 17/17; report schema and scope guard            |
| Python expanded conformance     | PASS   | 17/17; report schema and scope guard            |
| `pnpm sbom:check`               | PASS   | 184 production components                       |
| `pnpm container:check`          | PASS   | 97,154,044 bytes locally; reproducible/non-root |
| Compose three-image build       | PASS   | runtime, TypeScript Adapter and Python Adapter  |
| push runtime `29542809447`      | PASS   | complete verify, Buf and Compose                |
| PR runtime `29542810998`        | PASS   | complete verify, Buf and Compose                |
| PR Compose `29542811050`        | PASS   | governance Compose                              |
| PR quality `29542811006`        | PASS   | governance quality                              |

## Required matrix evidence

| Test  | Evidence                                                                        | Result |
| ----- | ------------------------------------------------------------------------------- | ------ |
| T-047 | actual 001-006 fixture, 007-012 upgrade/idempotence, worker continuation, reads | PASS   |
| T-048 | TypeScript Adapter expanded clause scenarios and restart probe, 17/17           | PASS   |
| T-049 | Python Adapter expanded clause scenarios and restart probe, 17/17               | PASS   |

The authoritative remote runtime jobs also reran the complete T-001..T-046 matrix, dependency
audit, SBOM, deployment, capacity, Docker, PostgreSQL 17, Buf lint/breaking and dual-language
conformance gates.

## Retained local limitation

The bundled Windows `grpc-tools` executable still fails to load with `0xc0000135`, so local
aggregate `pnpm build` cannot be treated as release evidence. Linux Docker and both remote
runtime jobs regenerated protobuf and passed build, proto-check and Buf; this limitation is
reported, not suppressed.
