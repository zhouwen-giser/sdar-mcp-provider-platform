# ADR-001: Runtime stack and protocol boundaries

Status: accepted  
Date: 2026-07-16

## Context

The greenfield repository needs a deployable MCP service while SEP-2663 support
in client/server libraries can evolve. Domain, scheduling, and persistence logic
must not become coupled to experimental SDK types.

## Decision

Use Node.js 22, strict TypeScript, ESM, and a pnpm workspace. Use the official
TypeScript MCP SDK for Streamable HTTP, but isolate all imports and conversion
logic in `packages/mcp-protocol`. Domain packages expose repository-owned,
wire-neutral models. Use AJV with Draft 2020-12 behavior and explicit byte,
depth, property-count, and regex constraints. Use Vitest for unit and integration
orchestration, ESLint for semantic linting, and Prettier for formatting.

The deployable service is `apps/runtime`; reusable packages have explicit public
exports and TypeScript project boundaries. Node and pnpm versions are pinned for
CI and container builds.

## Consequences

- MCP/SEP changes require adapter work at one boundary rather than state-engine
  rewrites.
- Wire conversion receives dedicated contract tests.
- Workspace setup is larger than a single-package service but enables dependency
  rules and a reusable conformance testkit.
- SDK capabilities are declared only when the Runtime and operation snapshot can
  both honor them.
