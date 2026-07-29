# ADR 0003: Provision one Runtime database per logical Provider

- Status: Accepted
- Date: 2026-07-26
- Goal: goal-02
- Task: G2-P0-B03

## Context

Runtime Task tables have no universal `provider_id` partition that safely permits unrelated
Providers to share one logical authority. Migration, backup, credentials, and incident isolation
also need a clear boundary.

## Decision

V0.1 provisions a separate Runtime Task Authority database and restricted Runtime role for each
logical Provider.

- Replicas of the same logical Provider share that Provider's Runtime database.
- Different logical Providers do not share unpartitioned Runtime Task tables.
- PMS Control, Runtime, and Provider Adapter databases remain distinct logical authorities.
- Provisioning credentials are separate from Runtime credentials and are never injected into the
  Runtime process.
- Runtime Migration scans only `migrations/runtime`, uses advisory locking and checksums, and runs
  before process start.
- Migration failure preserves the database and evidence; it never triggers automatic destructive
  recreation.

## Consequences

The platform manages more databases and roles, but obtains explicit security, migration, and
recovery boundaries. A future shared-database model requires partition keys, an upgrade design, and
new isolation E2E before a replacement ADR can be accepted.

## Non-goals

This ADR does not change delivered Migration files or make PMS authoritative for Runtime business
data.
