# Standalone PMS Console

This bundle starts four separate containers from one exact Git revision:

- `pms-postgres` — dedicated PostgreSQL 17 with a persistent volume;
- `pms-api` — production PMS composition and frozen Console V1 contract;
- `pms-worker` — asynchronous package sync and RuntimeDeployment reconciliation;
- `pms-web` — production API mode with the same-origin `/api/console/v1` proxy.

The browser-facing port defaults to `127.0.0.1:8088`. `pms-api` and `pms-worker` have no published
host port. The Worker image contains the immutable `2.0.0-rc.1` Runtime release and uses a separate
persistent state volume.

## Prepare configuration

```bash
cp deploy/pms-console/.env.example deploy/pms-console/.env
```

Edit `.env` and set `PMS_CONSOLE_SECRET_ROOT` to an absolute directory outside this repository.
Follow [secrets/README.md](secrets/README.md) to populate it. The deployment rejects missing,
in-repository, symlinked, over-permissive, mismatched, or incorrectly owned credentials.

`PMS_WEB_API_BASE` and `PMS_WEB_DATA_MODE` are intentionally fixed by Compose to
`/api/console/v1` and `api`. `PMS_WEB_API_UPSTREAM=http://pms-api:8090` exists only inside Docker;
it is never exposed to browser HTML.

## One-click lifecycle

The build command requires the current branch to be
`codex/goal-10-ugv-simulation-real-interface`, requires tracked source to be clean, creates an
immutable `git archive` build context, labels all three PMS images with exact `HEAD`, starts each
dependency in order, waits for health, and runs the non-destructive smoke suite.

```bash
bash deploy/pms-console/up.sh
bash deploy/pms-console/smoke.sh
bash deploy/pms-console/down.sh
```

To qualify a fresh-volume deployment, explicitly remove only this Compose project's named volumes:

```bash
bash deploy/pms-console/down.sh --volumes
bash deploy/pms-console/up.sh
bash deploy/pms-console/smoke.sh
```

`--volumes` irreversibly removes this package's PMS database and Worker state volumes. The default
`down.sh` preserves them.

## Verification boundary

`smoke.sh` proves PostgreSQL health, API readiness, Worker liveness, Web readiness, a Console
provider-list request through the Web origin without `Authorization` (authentication is deferred by
the frozen contract), local rejection of a machine route, and exact
image revision/running-image identity. It does not create a RuntimeDeployment or issue any UGV
movement, recon, gimbal, or effector command.
