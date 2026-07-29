# Goal 04 scope lock

## Authorized product boundary

Goal 04 may change only the single-host production lifecycle:

- the PM2 JavaScript API binding and its fixed `pm2@7.0.3` dependency;
- Runtime configuration-drift detection using non-secret fingerprints;
- PMS Worker configuration, production composition, and graceful shutdown;
- a bounded database-time scheduler that enqueues the existing
  `runtime_deployment.reconcile` job;
- production lifecycle tests, CI jobs, Platform 0.1.0 metadata, release
  evidence, checksums, SBOM, and handoff.

Expected implementation areas are:

```text
packages/pm2-runtime-adapter/**
apps/pms-worker/**
packages/pms-application/**
packages/pms-persistence-postgres/**
tests/pm2-adapter-e2e/**
tests/platform-production-lifecycle/**
scripts/**
.github/workflows/ci.yml
package.json
pnpm-lock.yaml
reports/platform-v0.1/**
reports/sbom/**
docs/operations/**
docs/review/GOAL04_*
.codex/goal-04/**
```

Each task card narrows this list further. Any necessary file outside its
allowed paths must be minimal and recorded in
`.codex/goal-04/decisions.md`.

## Preserved invariants

- Goal 2 and Goal 03 task state, handoff, evidence, and completion timestamps
  remain byte-for-byte unchanged.
- `runtime_deployment.reconcile` remains the only Runtime reconciliation job
  owner; database preparation remains an internal Reconciler port.
- `DEGRADED` recovery passes through `DISCOVERING`, and Catalog plus Registry
  publication precedes `ACTIVE`.
- Worker shutdown does not stop managed Runtime processes.
- Runtime cold start does not depend on PMS or Worker availability.
- PM2 may manage only `sdar-runtime-*`, with a fixed release root, fixed
  Runtime entry, fork mode, and one instance.
- Secrets use references or controlled files and never enter PM2 ordinary
  environment, logs, evidence, SBOM, or PR text.
- Existing frozen protocol, migrations 001–009, `verify:v2`, Provider
  regressions, audit, SBOM, Docker, and PMS production gates remain fail-closed.

## Explicit non-goals

- Kubernetes or another orchestrator;
- cross-host scheduling, multi-replica Runtime, load balancing, or a stable
  gateway;
- arbitrary shell, command strings, scripts, working directories, remote
  execution, or unconstrained environment injection;
- new Provider types, device protocols, business APIs, or Runtime Task
  Authority ownership;
- PMS migration 010 unless the task is stopped for the required human review;
- real UGV, NPC Tank, Home Assistant, external SDAR certification, rollout,
  merging `main`, or creating a Platform tag.

## Qualification boundary

Goal 04 may claim a controlled single-node production lifecycle using local
PostgreSQL, repository-pinned PM2, built Runtime code, and controlled Provider
fixtures. It must not promote that result to real-device or external-SDAR
certification.
