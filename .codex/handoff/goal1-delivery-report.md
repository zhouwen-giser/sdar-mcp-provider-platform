# Goal 1 delivery report

## Scope delivered

Goal 1 upgrades the offline MCP Tasks Runtime and Provider set into the
`sdar-mcp-provider-platform` foundation. It delivers a traceable source baseline, isolated
Migration authorities, strict Provider Packages, shared configuration contracts, the PMS control
plane and persistence, the PMS API/configuration center, and a Runtime Config Client with the first
real `OTEL_ENABLED` dynamic apply loop.

All 50 atomic task states are PASSED. Goal completion remains conditional on the terminal Handoff
validator returning 0 against the committed, clean worktree.

## Baseline and versions

- Offline source SHA-256:
  `000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`.
- Immutable offline import: `ad199f508cf67dbe77491cf90569daf5da8197bb`.
- Last implementation commit before handoff: `459c3f9c881816066dfc887e50d7a309733887f2`.
- Runtime/package version: `2.0.0-rc.1`.
- Goal branch: `codex/goal-01-platform-foundation`.

## Verification commands and evidence

| Gate | Result |
| --- | --- |
| Source baseline verifier | PASS; exact source SHA |
| `pnpm build` | PASS |
| `pnpm protocol:check` | PASS; 11 schemas, 74 frozen cases, 38 locked files |
| `pnpm test:migration-isolation` | PASS; 1/1 PostgreSQL test |
| `pnpm test:pms-migrations` | PASS; 4/4 PostgreSQL tests |
| `pnpm test:provider-packages` | PASS; 13/13 plus three-package self-check |
| `pnpm test:config-compat` | PASS; 8/8 compatibility and 36/36 contract tests |
| `pnpm test:pms-config-e2e` | PASS; 8/8 |
| Runtime Config E2E | PASS; 3/3 |
| `pnpm test:unit` | PASS; 30 files, 123 tests |
| `pnpm test:frozen-74` | PASS |
| Lint, typecheck, frozen lockfile, diff check | PASS |

PostgreSQL evidence uses the redacted label `<local-postgres>`, never its credential.

## Architecture and security boundaries

- PMS owns only Provider/configuration/Audit/Job Lease control-plane state and no Runtime Task,
  Command, Scheduler, Recovery, or Outbox business tables.
- Runtime remains Task Authority and MCP data plane, with a no-PMS cold-start path.
- Provider Adapters remain the device/domain execution plane; `vendor_managed` is the production
  default.
- One logical Provider's Runtime replicas share its Task Authority database. Different logical
  Providers do not share unpartitioned Runtime Task tables.
- Runtime 001–023 and Provider 024/025 migrations remain byte-preserved and checksum-mapped. PMS
  migrations are append-only under a separate authority.
- Shared `ConfigurationDefinition` metadata drives Zod and generated Schema/default/UI artifacts.
- Secrets flow only as SecretRef or `*_FILE`; Runtime Config auth reads
  `PMS_RUNTIME_CONFIG_TOKEN_FILE`.
- Operation Catalog authority remains Runtime `server/discover` plus `tools/list`.
- Goal 1 implements no PM2 or RuntimeDeployment control. Goal 2 must use an explicit Runtime
  entrypoint allowlist and forbid arbitrary script, cwd, environment, and command execution.

## Provider qualification

| Package | Component | Real resource |
| --- | --- | --- |
| `builtin.isr.vehicle.ugv@1.0.0` | passed | pending |
| `builtin.isr.vehicle.npc-tank@0.1.0` | passed | pending |
| `builtin.home-assistant.climate@0.1.0` | passed | pending |

Mocks and fakes are excluded from the production Registry. No real-resource or combined system
certification is claimed.

## Goal 2 handoff

`goal1-handoff.json` inventories the PMS API, PMS Worker, Runtime, eight foundation packages, all
current PMS API v1 paths, all 11 PMS tables, four Migration roots, authority boundaries, and Goal 1
non-goals. Goal 2 can add RuntimeDeployment, governed process lifecycle, and Runtime-discovered
catalog capabilities without changing these authorities or making PMS a Runtime cold-start
dependency.

## External gaps and non-goals

Real UGV/NPC devices, ISR MQTT feeds, an independently managed Home Assistant installation, and
physical climate resources were unavailable. Their `realResourceStatus` remains `pending`.
RuntimeDeployment, PM2 governance, Runtime Registry/Catalog, and Console remain Goal 2 scope.

## Upgrade and rollback

Use `docs/database/MIGRATION_SET_UPGRADE.md`, `docs/database/PMS_SCHEMA.md`,
`docs/api/PMS_API.md`, `docs/operations/PMS_WORKER.md`, and
`docs/providers/qualification.md`. Database history is append-only; rollback restores a matching
prior application artifact and routing rather than editing SQL or Migration history.

## Artifacts

- `.codex/handoff/goal1-handoff.json`
- `.codex/handoff/goal1-delivery-report.md`
- `.codex/reports/goal-01-final.md`
- `.codex/reports/phase-P0.md` through `.codex/reports/phase-P5.md`
- `reports/evidence/migration-isolation.json`
