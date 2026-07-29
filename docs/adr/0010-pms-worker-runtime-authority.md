# ADR 0010: PMS Worker Runtime authority and secure composition inputs

## Status

Accepted.

## Context

The PMS Worker will become the single-node composition root for Runtime infrastructure lifecycle.
Its authority spans database preparation, release selection, secret-file materialization, PM2
process convergence, health and identity verification, and Catalog/Registry publication. Those
capabilities require filesystem and timing inputs that were absent from the foundation bootstrap.

Allowing partial configuration, inline credentials, overlapping writable roots, or implicit
infrastructure construction would make the production authority difficult to audit and unsafe to
operate.

## Decision

Runtime lifecycle configuration is an atomic optional group during the transition to production
composition. If any Runtime input is present, every provisioning file, controlled root, and bounded
timing input is required and validated before infrastructure construction.

- Database and provisioning credentials use regular `0600`-or-narrower files under safe parents.
- Release, secret, configuration-cache, and PM2 roots are canonical existing directories. Private
  roots are `0700`-or-narrower and all four roots are non-overlapping.
- Inline database, provisioning, Runtime, configuration-token, and PM2 secrets are rejected.
- Existing Worker polling, lease, claim, and retry configuration remains unchanged.
- An immutable composition contract names repositories, database preparation, lifecycle, health,
  identity, Catalog/Registry, scheduler, and cleanup authorities. It does not construct or start
  infrastructure.

The Worker owns desired/observed Runtime infrastructure state and control-plane projections. It
does not own Runtime Task data. Worker shutdown stops scheduling and claims, drains its own current
work, and closes Worker resources; it never stops or deletes running Runtime processes.

## Consequences

Production composition can fail before acquiring database, PM2, or scheduler resources when inputs
are incomplete or unsafe. Tests can supply the complete group deterministically while the existing
foundation bootstrap remains behaviorally unchanged until the dedicated composition task.
