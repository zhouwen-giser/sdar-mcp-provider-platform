# ADR 0001: Keep one monorepo with separate process authorities

- Status: Accepted
- Date: 2026-07-26
- Goal: goal-02
- Task: G2-P0-B03

## Context

The platform shares contracts and delivery tooling, but PMS, Runtime, and Provider Adapters own
different authority boundaries. Combining them into one process would make PMS availability part
of Runtime task execution and would make it easier for the control plane to cross into Runtime
business tables.

## Decision

Keep one TypeScript monorepo and deploy separate processes for `pms-api`, `pms-worker`, `pms-web`,
each managed `mcp-runtime` instance, and any explicitly platform-managed Provider Adapter.

- PMS owns desired deployment/configuration state, Catalog, Registry, and Audit.
- Runtime owns Task, Command, Scheduler, Recovery, Notification, and Outbox execution state.
- Provider Adapters own device connections, resource facts, operation side effects, and device
  safety.
- Shared packages contain contracts and ports, not cross-authority repositories.
- Runtime cold start uses Bootstrap Config and LKG; PMS is not its only startup dependency.

## Consequences

Processes can fail and scale independently while sharing versioned contracts. Integration requires
explicit APIs and health checks. PMS must never import Runtime Task repositories or proxy MCP
business calls.

## Non-goals

This ADR does not introduce a distributed service mesh, split the repository, or define the later
RuntimeDeployment implementation.
