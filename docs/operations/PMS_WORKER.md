# PMS Worker operations

The PMS Worker is a control-plane background process. Its production bootstrap runs exactly two
allowlisted jobs: `provider_package.sync`, which projects the repository-controlled Provider Package
registry, and `runtime_deployment.reconcile`, which owns the complete desired/observed Runtime
lifecycle.

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

The following Runtime lifecycle inputs are an atomic group. Supplying any one requires all of them.
The production bootstrap also requires this group; omission fails closed with
`PMS_WORKER_RUNTIME_CONFIG_REQUIRED`.

| Variable                                    | Requirement | Purpose                                      |
| ------------------------------------------- | ----------- | -------------------------------------------- |
| `PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE` | required    | File-only provisioning authority             |
| `PMS_RUNTIME_RELEASE_ROOT`                  | required    | Versioned, read-only Runtime release root    |
| `PMS_RUNTIME_SECRET_ROOT`                   | required    | Private Runtime secret-file root             |
| `PMS_RUNTIME_CONFIG_CACHE_ROOT`             | required    | Private per-Runtime configuration cache root |
| `PMS_RUNTIME_CONTROL_PLANE_URL`             | required    | HTTPS, or loopback HTTP, PMS Runtime API URL |
| `PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT` | required    | Private per-instance credential tree         |
| `PMS_PM2_HOME`                              | required    | Private isolated PM2 state directory         |
| `PMS_RUNTIME_RECONCILE_INTERVAL_MS`         | required    | Bounded periodic reconcile interval          |
| `PMS_RUNTIME_RECONCILE_TIMEOUT_MS`          | required    | Bounded end-to-end reconcile timeout         |
| `PMS_RUNTIME_HEALTH_TIMEOUT_MS`             | required    | Bounded health/identity probe timeout        |

`PMS_POSTGRES_PROVISIONING_CREDENTIAL_FILE` contains one JSON object with exactly `clusterRef`,
`adminSecretRef`, `adminDatabaseUrl`, and `runtimePassword`. The cluster and secret references bind
the file authority to one Database Profile, while the URL identifies its restricted PostgreSQL
provisioning principal; the profile host and port must also match that URL. `runtimePassword` must
contain at least 16 characters. The Worker never accepts any of these values inline. Database
profiles must use the deployment-scoped Runtime secret reference
`file/v1/<deploymentId>/database/runtime`; the Worker materializes its connection URL as a `0600`
file under `PMS_RUNTIME_SECRET_ROOT`.

`PMS_RUNTIME_RELEASE_ROOT/runtime-releases.json` is the Runtime release authority. Only listed
versions are eligible, and every start resolves the fixed built entry
`dist/apps/runtime/src/main.js` under its version directory. The PM2 adapter uses the repository
dependency pinned to `7.0.3` and the JavaScript API with the isolated `PMS_PM2_HOME`; no PM2 CLI is
invoked. Keep `PMS_PM2_HOME` short enough for the host's Unix-domain socket path limit; a deeply
nested path can prevent the PM2 bus from starting even when the directory itself is valid.

Database and provisioning files must be absolute, regular, non-symlink, non-empty, no broader than
`0600`, and located under a non-group-writable/non-world-writable parent. Release roots may be
readable but not group/world writable. Secret, cache, and PM2 roots must be existing canonical
directories with permissions no broader than `0700`. Release, secret, cache, and PM2 roots must be
pairwise distinct and cannot contain one another.

The Worker resolves each Runtime control-plane token from
`PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT/providers/<providerId>/deployments/<deploymentId>/instances/<instanceId>/control-plane.token`.
The credential root must be canonical, existing, non-symlink and no broader than `0700`; token files
must be canonical, regular, non-symlink, non-empty, singly linked and no broader than `0600`.
Identity traversal, unsafe parents, missing files and reused hard links fail closed. The legacy
`PMS_RUNTIME_CONTROL_PLANE_TOKEN_FILE` variable is rejected and has no production fallback.

PMS API credential descriptors remain explicit per principal. Adding or rotating a V0.1 Runtime
credential requires an atomic credential-tree and API-descriptor update followed by a PMS API
restart. See [ADR 0012](../adr/0012-instance-scoped-runtime-control-plane-credentials.md).

Inline database URLs, provisioning credentials, Runtime secrets/config tokens, and PM2 secrets are
rejected. File contents are consumed only by their owning adapters and are never included in health
state, errors, Audit, or evidence.

Bootstrap applies only the PMS migration set, validates the full Runtime configuration, constructs
database preparation, migration, secret, release, PM2, health, identity, Catalog/Registry and
reconcile components, starts the periodic scheduler, and finally starts the worker claim loop. A
construction or startup failure disconnects PM2, closes the provisioning connection and PMS Pool,
and leaves no scheduler running.

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

The reconcile handler derives its operation ID and idempotency key from the job ID and fencing
token. Database preparation remains an internal reconciler service and is never registered as an
external job. A healthy Runtime reaches `ACTIVE` only after provider identity verification and
successful Catalog plus Registry publication. Provisioning, migration, health, identity, discovery,
or publication failures are fail-closed and are retried through the fenced reconcile job.

## Health and shutdown

The in-process health indicator exposes `starting`, `ready`, `failed`, `stopping`, and `stopped`.
It contains only readiness, the last successful loop timestamp, and a stable failure code.

`SIGTERM` and `SIGINT` stop the scheduler first, stop new claims, interrupt the poll delay, and wait
for the current handler up to the lease-duration shutdown bound. The Worker then disconnects its PM2
JavaScript API and provisioning connection before closing the PMS Pool. Repeated stop requests are
safe. A shutdown timeout is reported as `PMS_WORKER_SHUTDOWN_TIMEOUT`.

Choose `PMS_WORKER_CLAIM_LIMIT` together with the lease duration and worst-case handler time. A
Worker drains its already-claimed batch serially during shutdown; oversized batches can exhaust the
lease-duration shutdown bound.

Worker authority is limited to desired/observed Runtime infrastructure and its control-plane
projections. Runtime Task data belongs to the Runtime database and is never read or mutated by the
Worker. Stopping or restarting the Worker must stop scheduling/claiming and close its own resources;
it must not stop or delete already-running Runtime processes.
