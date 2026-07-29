# PMS Worker operations

The PMS Worker is a control-plane background process. Its current production bootstrap runs one
allowlisted job, `provider_package.sync`, which projects the repository-controlled Provider Package
registry into the PMS database. The secure Runtime composition input contract is available, while
construction and handler registration remain deferred to the scoped production-composition task.

The external RuntimeDeployment lifecycle model reserves exactly one Job Type:
`runtime_deployment.reconcile`. Its handler invokes the complete application reconciler under one
lease and fencing context. Database preparation is an internal reconciler port/service, not a
second external job. See [ADR 0007](../adr/0007-single-runtime-reconcile-job.md).

## Bootstrap configuration

| Variable                       |                   Default | Purpose                                                 |
| ------------------------------ | ------------------------: | ------------------------------------------------------- |
| `PMS_DATABASE_URL_FILE`        |                  required | Absolute path to a file containing the PMS database URL |
| `PMS_WORKER_ID`                |        `pms-worker-<pid>` | Stable lease owner identity                             |
| `PMS_WORKER_POLL_INTERVAL_MS`  |                    `1000` | Delay between claim cycles                              |
| `PMS_WORKER_LEASE_DURATION_MS` |                   `30000` | Database-time lease duration                            |
| `PMS_WORKER_CLAIM_LIMIT`       |                      `10` | Maximum jobs claimed per cycle                          |
| `PMS_WORKER_RETRY_DELAY_MS`    |                    `5000` | Delay before a failed job becomes available             |
| `PMS_WORKSPACE_ROOT`           | process working directory | Controlled package and migration root                   |

The following Runtime lifecycle inputs are an atomic group. Supplying any one requires all of them;
omitting the group preserves the foundation-only Worker until production composition is installed.

| Variable                                    | Requirement | Purpose                                      |
| ------------------------------------------- | ----------- | -------------------------------------------- |
| `PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE` | required    | File-only provisioning authority             |
| `PMS_RUNTIME_RELEASE_ROOT`                  | required    | Versioned, read-only Runtime release root    |
| `PMS_RUNTIME_SECRET_ROOT`                   | required    | Private Runtime secret-file root             |
| `PMS_RUNTIME_CONFIG_CACHE_ROOT`             | required    | Private per-Runtime configuration cache root |
| `PMS_PM2_HOME`                              | required    | Private isolated PM2 state directory         |
| `PMS_RUNTIME_RECONCILE_INTERVAL_MS`         | required    | Bounded periodic reconcile interval          |
| `PMS_RUNTIME_RECONCILE_TIMEOUT_MS`          | required    | Bounded end-to-end reconcile timeout         |
| `PMS_RUNTIME_HEALTH_TIMEOUT_MS`             | required    | Bounded health/identity probe timeout        |

Database and provisioning files must be absolute, regular, non-symlink, non-empty, no broader than
`0600`, and located under a non-group-writable/non-world-writable parent. Release roots may be
readable but not group/world writable. Secret, cache, and PM2 roots must be existing canonical
directories with permissions no broader than `0700`. Release, secret, cache, and PM2 roots must be
pairwise distinct and cannot contain one another.

Inline database URLs, provisioning credentials, Runtime secrets/config tokens, and PM2 secrets are
rejected. File contents are consumed only by their owning adapters and are never included in health
state, errors, Audit, or evidence.

Bootstrap applies only the PMS migration set, builds the allowlisted job registry, and then marks the
worker ready. The worker receives a Pool for the PMS control-plane database; it has no Runtime
database discovery or fallback.

## Job and lease behavior

- Claim uses database time, `FOR UPDATE SKIP LOCKED`, a lease token, and a monotonically increasing
  fencing token.
- External work runs after the claim transaction has completed.
- Successful handlers complete the lease only when job ID, owner, token, and fence still match.
- Failed handlers release the claim into a delayed failed state.
- An expired lease can be recovered by another worker with a higher fence; stale workers cannot
  renew, complete, release, or fail it.
- Unknown job types are not claimed because claim is restricted to the registry allowlist.

The package sync handler uses `worker:<workerId>` as the Audit actor and includes job ID and fencing
token in the correlation ID.

When RuntimeDeployment composition is supplied by the scoped production-composition change, the reconcile handler
derives its operation ID and idempotency key from the job ID and fencing token. The registry rejects
any second handler for `runtime_deployment.reconcile` with `PMS_JOB_HANDLER_DUPLICATE`. This
repository does not currently add that handler to `bootstrapPmsWorker`; doing so requires the
deferred production lifecycle dependencies. The immutable composition contract reserves explicit
slots for repositories, database preparation, lifecycle, health, identity, Catalog/Registry,
scheduler, and cleanup without constructing any of them.

## Health and shutdown

The in-process health indicator exposes `starting`, `ready`, `failed`, `stopping`, and `stopped`.
It contains only readiness, the last successful loop timestamp, and a stable failure code.

`SIGTERM` and `SIGINT` stop new polling, interrupt the poll delay, wait for the current handler to
finish, and then close the PMS Pool. Repeated stop requests are safe.

Worker authority is limited to desired/observed Runtime infrastructure and its control-plane
projections. Runtime Task data belongs to the Runtime database and is never read or mutated by the
Worker. Stopping or restarting the Worker must stop scheduling/claiming and close its own resources;
it must not stop or delete already-running Runtime processes.
