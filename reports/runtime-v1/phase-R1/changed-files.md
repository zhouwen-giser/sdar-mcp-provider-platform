# Phase R1 Changed Files

## Build and delivery

- Root package/workspace/TypeScript/ESLint/Prettier/Vitest configuration and lockfile.
- `.github/workflows/ci.yml`, Dockerfile, Compose, Docker ignore rules.
- Reproducible Proto and Python Adapter smoke scripts.

## Runtime and packages

- `apps/runtime`: configuration, startup, health/readiness.
- `packages/adapter-protocol`: paths, dynamic service definition, gateway and types.
- `packages/observability`: structured redacted logger foundation.
- `proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto` and generated JS/TS bindings.

## Examples and tests

- TypeScript and Python mock Adapter foundations and images.
- Unit config/health, contract Proto/Python syntax, and real gRPC integration tests.
- README and Adapter protocol documentation.

No PostgreSQL schema migration is introduced in R1; append-only migrations begin in R2/R3 as mapped by the task package.
