# Current Repository Assessment

Date: 2026-07-16  
Branch: `feature/mcp-tasks-provider-runtime-v1`  
Baseline SHA: `7e501d0` (`origin/main`, initial commit)

## Conclusion

This is a greenfield implementation repository. Before R0 it contained only an
initial Git commit plus the user-supplied task package, three authoritative
Markdown specifications (and source DOCX copies), report templates, and quick
start material. There was no application code, package manifest, CI workflow,
database migration, generated protocol code, container definition, or test.

No `AGENTS.md` or `PLANS.md` exists in the repository. The root task package is
therefore the repository-specific execution authority, subject to the document
priority declared in that package.

## Repository and toolchain inventory

| Area              | Baseline finding | R0 decision                                                              |
| ----------------- | ---------------- | ------------------------------------------------------------------------ |
| Runtime language  | None             | Node.js 22, TypeScript strict, ESM                                       |
| Package manager   | None             | pnpm workspace, lockfile committed                                       |
| MCP server        | None             | Official TypeScript MCP SDK behind `packages/mcp-protocol`               |
| Adapter transport | Design only      | gRPC/Protobuf v1; generated TS stubs and Python example                  |
| Persistence       | None             | PostgreSQL and explicit SQL repositories/migrations                      |
| Scheduler         | None             | PostgreSQL claims/leases; injectable clock; no in-memory authority       |
| Tests             | None             | Vitest plus real PostgreSQL/gRPC/HTTP suites                             |
| CI                | None             | GitHub Actions running formatting, lint, typecheck, build and test gates |
| Containers        | None             | Multi-stage Dockerfile and Compose development/E2E stack                 |
| Observability     | None             | Pino, Prometheus exposition, OpenTelemetry API integration               |

Observed local tools:

- Node.js `v22.23.1`
- Corepack `0.34.6`
- pnpm `11.13.1`
- npm `10.9.8`
- Python `3.10.12`
- Docker `29.6.1`, Compose `v5.3.1`
- `protoc` and `buf` are not globally installed; repository-managed generation
  and containerized compatibility checks will make global installation optional.

## Baseline commands

Executed from the repository root on 2026-07-16:

| Command                           | Result                                                          |
| --------------------------------- | --------------------------------------------------------------- |
| `git fetch origin --tags --prune` | PASS; `origin/main` at `7e501d0`                                |
| `git status --short --branch`     | PASS; user task-package files present and preserved             |
| `pnpm test`                       | FAIL (expected baseline): `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |
| `pnpm build`                      | FAIL (expected baseline): `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` |

There was no narrower baseline test or build command to run. R1 must replace
this empty baseline with discoverable, passing workspace commands.

## Existing assets that will be reused

- `SDAR_MCP_Tasks_Runtime_Codex_Goal_Task_Package_V1.0.md` defines R0-R9 and
  delivery gates.
- `references/SDAR_MCP_Tasks_Provider_Profile_V1.0.md` is the highest-priority
  normative behavior specification.
- Runtime and Adapter design documents define module boundaries and protocol
  responsibilities.
- `templates/` supplies phase, blocker, and final-report structure.
- The root traceability seed is retained and expanded into the implementation
  matrix rather than replaced silently.

## Planned repository shape

```text
apps/runtime/                         deployable Streamable HTTP service
packages/domain/                      SDK-free state, timing, result model
packages/mcp-protocol/                MCP wire boundary and routing
packages/adapter-protocol/            generated types and gRPC gateway
packages/operation-registry/          Manifest validation and tool catalog
packages/task-engine/                 admission, scheduler, control, recovery
packages/persistence-postgres/        repositories and transactions
packages/observability/               logging, metrics and tracing boundary
packages/conformance-testkit/         P0-P4 and Adapter verification
proto/io/sdar/mcp/tasks/adapter/v1/   normative Protobuf IDL
migrations/                            append-only PostgreSQL migrations
examples/mock-adapter-typescript/     durable TypeScript reference Adapter
examples/mock-adapter-python/         durable Python reference Adapter
tests/                                 contract/integration/recovery/security/E2E
deploy/                                Compose and Kubernetes/Helm assets
docs/                                  decisions, implementation and operations
reports/runtime-v1/                    phase and release evidence
```

## Specification reconciliation

No irreconcilable conflict was found. The task package's frozen execution rule
clarifies the design documents: every operation uses `StartOperation`, while
`synchronous`, `task_capable`, `task_required`, and scheduled calls differ only
in Runtime publication behavior. That clarification will be encoded in Proto
comments, registry validation, and contract tests.

The Runtime design's coarse R0-R4 implementation table is superseded for work
sequencing by the task package's explicit R0-R9 phases; normative behavior is
unchanged.

## Risks and controls

- SEP-2663 SDK support is experimental: all SDK-specific values remain inside
  the MCP protocol package, with domain-owned wire-neutral types and contract
  tests.
- Cross-process crash windows cannot be made atomic: durable admission intents,
  Adapter task-id idempotency, and Reconcile provide recovery evidence.
- Time tests can become flaky: the task engine accepts a Clock and scheduler
  claims are database-driven.
- A mock Adapter must still be restart-safe: both reference Adapters use durable
  storage for task-to-execution binding rather than a process-only map.
- Docker availability does not imply the daemon is usable in every CI runner;
  `pnpm verify` will fail clearly when required integration prerequisites are
  absent instead of silently skipping them.
