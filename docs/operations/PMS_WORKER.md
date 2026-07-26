# PMS Worker operations

The PMS Worker is a control-plane background process. In Phase P4 it runs one allowlisted job,
`provider_package.sync`, which projects the repository-controlled Provider Package registry into the
PMS database. It does not manage Runtime processes or deployments.

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

Inline `PMS_DATABASE_URL` and `DATABASE_URL` are rejected. The database URL file is read for Pool
construction and is never included in health state, errors, or logs.

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

## Health and shutdown

The in-process health indicator exposes `starting`, `ready`, `failed`, `stopping`, and `stopped`.
It contains only readiness, the last successful loop timestamp, and a stable failure code.

`SIGTERM` and `SIGINT` stop new polling, interrupt the poll delay, wait for the current handler to
finish, and then close the PMS Pool. Repeated stop requests are safe.
