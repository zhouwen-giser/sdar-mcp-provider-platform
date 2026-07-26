# Phase P4 — PMS core and persistence

Status: PASSED

## Delivered scope

- Pure `@sdar/pms-domain` entities, branded identifiers, lifecycle transitions, Provider–Resource
  many-to-many bindings, repository ports, optimistic preconditions, UoW, Audit, and fenced Job
  Lease contracts.
- Append-only PMS migration set with Provider Type, versioned Provider Package, Provider, Resource,
  binding, configuration definition/revision/Ack, Audit, Job Lease, and PMS migration metadata.
- PostgreSQL adapters using parameterized queries, explicit transaction callbacks, stable
  uniqueness/concurrency errors, checksum-locked migrations, and no Runtime database connection.
- Transactional synchronization of the three controlled Provider Packages. Package files remain
  authoritative; matching checksums are no-ops and database drift is overwritten from files.
- Database-enforced append-only Audit, actor/correlation application context, database-time lease
  claim/renew/recovery, and fencing.
- PMS Worker bootstrap, allowlisted job registry, Provider Package sync handler, health state, and
  graceful signal drain.

## Control-plane boundary

The PMS schema contains only its 11 control-plane/metadata tables. It does not contain Runtime Task,
Command, Scheduler, Recovery, or Outbox business tables. PMS migrations use their own directory,
history table, checksum, and advisory lock.

The Worker receives only an injected PMS Pool. Database credentials are accepted through
`PMS_DATABASE_URL_FILE`; inline database URL variables are rejected. The Worker contains no process
or Runtime deployment management implementation.

## Acceptance evidence

| Area | Evidence |
| --- | --- |
| Domain | Branded IDs, hosting default, N:N relation, invalid transitions, pure port type scan |
| Migration | Empty isolated schema, full set applied twice, exact table boundary, SQL constraints |
| Persistence | Catalog/config/Audit/job integration, parameterization, unique/stale error mapping, UoW commit/rollback |
| Package sync | Three first imports, checksum no-op, source restores DB drift, damaged package atomic rejection |
| Audit and lease | DB mutation trigger, two-worker race, expired recovery, stale fence rejection, DB-time renew |
| Worker | Secret-file config, registry allowlist, job completion/failure, package sync identity, graceful stop |

Mandatory task commands and their pass counts are recorded in `.codex/execution-log.md`. Phase P4
also passed full TypeScript compilation, lint, formatting, build, frozen lockfile, and diff checks.
