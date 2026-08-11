# PMS control-plane schema

The PMS database is a control-plane store. It owns Provider metadata, configuration publication,
audit history, and worker leases. It never owns or accesses Runtime Task Authority tables or
Provider Adapter business tables.

## Migration set

PMS migrations are append-only SQL files in `migrations/pms/`, starting with
`001_control_plane_foundation.sql`. Migration `002_provider_package_source_projection.sql` adds the
lossless source descriptor projection and aligns Provider Type IDs with the underscores used by the
delivered packages. Migration `003_audit_append_only.sql` rejects Audit updates and deletes at the
database boundary. Migration `004_config_revision_history_guard.sql` protects immutable
configuration payloads and legal lifecycle transitions. Migration `005_runtime_deployment.sql`
adds the Runtime desired-state aggregate, actual process projection, and idempotent action history.
A PMS migration `009_runtime_registration.sql` adds the runtime registration projection table to persist
registration session metadata with heartbeat and expiry state. Migration
`010_external_runtime_deployment.sql` adds an explicit `direct_container` authority, expected external
process identity, and separate control and advertised endpoints while preserving existing PM2 rows.
A PMS migration runner must:

1. resolve only the `pms` migration set;
2. serialize runners with a PMS-specific advisory lock;
3. normalize line endings and calculate a lowercase SHA-256 checksum;
4. record the full filename and checksum in `pms_schema_migration`;
5. reject a checksum mismatch instead of modifying an applied migration.

The initial migration uses `CREATE TABLE IF NOT EXISTS` and
`CREATE INDEX IF NOT EXISTS`, so applying the SQL twice is safe. Migration history still provides
the authoritative application and checksum record.

## Tables and ownership

| Table                       | Purpose                                                                   | Key boundary                                 |
| --------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- |
| `pms_schema_migration`      | PMS migration filename, checksum, and application time                    | PMS-only metadata                            |
| `provider_type`             | Provider taxonomy and lifecycle                                           | Logical type ID                              |
| `provider_package`          | Versioned built-in/offline package descriptor                             | Package ID, version, immutable checksum      |
| `provider`                  | Logical Provider and hosting mode                                         | Vendor-managed by default                    |
| `resource`                  | Environment-scoped resource inventory                                     | `(environment, resource_id)`                 |
| `provider_resource_binding` | Provider–Resource many-to-many relation                                   | No single-resource field on Provider         |
| `config_definition`         | Configuration target, schema, defaults, and field policy                  | Unique configuration business key            |
| `config_revision`           | Immutable configuration content and publication state                     | Monotonic revision per definition            |
| `config_ack`                | Runtime application result for a revision                                 | One Ack per Runtime instance and revision    |
| `audit`                     | Append-only control-plane audit event                                     | Mutation-blocking trigger and query indexes  |
| `job_lease`                 | Short PMS worker claim with fencing token                                 | No external work inside DB transactions      |
| `runtime_deployment`        | Runtime desired state and lifecycle projection                            | Provider FK and desired/observed revisions   |
| `runtime_registration`      | Runtime registration heartbeat snapshot and registration state            | Deployment- and instance-scoped runtime rows |
| `runtime_process`           | PM2/direct-container health, registration, Catalog, and config projection | Stable instance ID; PID is not identity      |
| `runtime_deployment_action` | Idempotent lifecycle action history                                       | Deployment-scoped idempotency and Audit refs |

No table named `provider_task`, `task_command`, `task_observation`, `scheduler`, `recovery`,
`outbox_event`, or other Runtime business table is present. Runtime and Provider migration sets
remain independently owned and are not referenced by foreign keys.

## Integrity rules

- Domain identifiers are non-empty and constrained to their documented formats.
- Checksums are 64 lowercase hexadecimal characters.
- Structured documents are checked as JSON objects; secret paths are JSON arrays.
- Status, hosting mode, apply mode, target type, and Ack state use closed check constraints.
- Timestamps use `timestamptz`; update and publication times cannot precede creation.
- A configuration definition can have at most one currently `published` revision.
- A leased job must have an owner, token, and expiry. Non-leased rows cannot retain lease data.
- `provider_resource_binding` has indexes in both Provider and Resource lookup directions.
- RuntimeDeployment is linked to an existing Provider and separates desired from observed
  revisions for compare-and-set updates.
- RuntimeRegistration is linked to RuntimeDeployment/RuntimeProcess and stores registration session, heartbeat,
  and expiry state without duplicating `providerId`, `runtimeVersion`, `configRevision`, or `readinessState`
  in this table.
- V0.1 desired replica count is constrained to one when running and zero when stopped or draining.
- RuntimeProcess identity is a stable `runtime_instance_id`; PID may change after a restart.
- Platform-managed PM2 names are restricted to `sdar-runtime-*`, globally unique, and ports are
  unique inside an environment. Direct-container rows instead require immutable control and
  advertised endpoints and do not carry PM2 identity.
- Runtime action history requires a deployment-scoped idempotency key, closed action status,
  structured result details, correlation/actor identity, and consistent completion timestamps.

PMS stores configuration secret references and public metadata only. Secret values must remain in
referenced files or an external secret facility; they must not be embedded in JSON documents,
audit metadata, migration history, logs, or Git.
