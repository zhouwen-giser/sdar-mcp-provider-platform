# SDAR MCP Provider Platform scope and compatibility

## Product scope

SDAR MCP Provider Platform upgrades the locked SDAR MCP Tasks Provider Runtime
and its UGV, NPC Tank, and Home Assistant Provider assets into one monorepo. The
V0.1 platform scope includes:

- PMS control-plane applications for desired state, configuration, deployment,
  Catalog, Registry, audit, and administrative workflows;
- one independently running standard MCP Tasks Runtime per logical Provider by
  default;
- explicit Runtime, Provider, and PMS Migration ownership;
- Provider Package metadata and validation for the delivered Provider assets;
- a versioned configuration flow with Draft, Publish, Rollback, Pull, Watch,
  Ack, LKG, and explicit restart requirements;
- single-node PM2 Fork Mode governance for allowlisted Runtime entry points;
- discovery-derived Operation Catalog and versioned Registry snapshots.

The platform keeps these authority boundaries:

| Component        | Authority                                                                                   | Must not own                                                        |
| ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| PMS              | Desired state, configuration, deployment, Catalog, Registry, audit                          | Runtime Task, Command, Scheduler, Recovery, or Outbox business data |
| Runtime          | MCP data plane, Task Authority, Scheduler, Recovery, Command, Notification, Adapter Gateway | PMS persistence or Provider device control                          |
| Provider Adapter | Device connection, Resource facts, Operation side effects, device safety                    | Runtime Task Authority or PMS control-plane state                   |

PMS and Runtime share a repository but run as separate processes. Runtime does
not require PMS as its only cold-start dependency. A logical Provider's Runtime
replicas share one Runtime Task Authority database; different Providers do not
share Task tables without explicit `provider_id` isolation.

## V0.1 non-goals

V0.1 does not:

- create Kubernetes, Docker orchestration, or cross-host scheduling;
- expose arbitrary scripts, working directories, environment variables, or
  commands through PM2 management;
- manage supplier-owned production Provider Adapters by default;
- let PMS proxy MCP business traffic or access Runtime Task tables;
- let Runtime write directly to ClickHouse;
- change frozen protocol semantics or rewrite delivered Migrations;
- provide complex canary rollout, traffic splitting, or automatic
  cross-database migration;
- claim real-device qualification from mock or component-level evidence;
- enable multiple replicas for one Provider without a separately designed,
  tested, stable endpoint.

## Compatibility strategy

The repository's presentation identity changes to **SDAR MCP Provider
Platform**, while delivered code identities remain stable during the additive
upgrade:

- the root npm package remains `sdar-mcp-tasks-provider-runtime`;
- existing `@sdar/*` workspace package names are not bulk-renamed;
- existing `dev:*`, `test:*`, `verify:*`, build, protocol, and Migration
  scripts remain available;
- Runtime and Provider application entry points retain their paths;
- Node.js `>=22 <23`, pnpm `>=11 <12`, and `pnpm@11.13.1` remain the repository
  toolchain contract.

New platform applications and packages must use explicit ports and adapters
without making Runtime core depend on PMS persistence. Any future incompatible
rename requires a separately planned migration and compatibility window.
