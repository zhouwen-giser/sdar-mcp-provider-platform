# PMS Console secret preparation

Never store live files in this repository directory. `PMS_CONSOLE_SECRET_ROOT` must point to an
absolute directory outside the repository, owned by UID `1000`, with this layout:

```text
<secret-root>/
├── postgres-password
├── pms-database-url
├── api/
│   ├── management.json
│   └── runtime.json
├── worker/
│   └── postgres-provisioning.json
└── runtime-control-plane/
```

Directories must be mode `0700`; files must be regular, non-symlink, singly linked, non-empty, and
mode `0600`. The PostgreSQL password should be a generated high-entropy value. The database URL
must use host `pms-postgres`, user `pms_admin`, database `pms`, and the exact password stored in
`postgres-password`.

Copy the three committed `.example` descriptors and replace every `REPLACE_...` marker. Console
authentication is deferred by the frozen contract, so `management.json` deliberately has no
principals and the Web does not send `Authorization`. `runtime.json` likewise remains empty for this
packaging qualification. A separately authorized RuntimeDeployment setup may populate the instance
control-plane credential tree using:

```text
runtime-control-plane/providers/<providerId>/deployments/<deploymentId>/instances/<instanceId>/control-plane.token
```

The Worker provisioning descriptor must use the same internal PostgreSQL admin URL/password. Its
`runtimePassword` is a separate value of at least 16 characters. After preparation, a typical Linux
permission pass is:

```bash
chmod 0700 "$PMS_CONSOLE_SECRET_ROOT" \
  "$PMS_CONSOLE_SECRET_ROOT/api" \
  "$PMS_CONSOLE_SECRET_ROOT/worker" \
  "$PMS_CONSOLE_SECRET_ROOT/runtime-control-plane"
find "$PMS_CONSOLE_SECRET_ROOT" -type f -exec chmod 0600 {} +
sudo chown -R 1000:1000 "$PMS_CONSOLE_SECRET_ROOT"
```

The preflight compares the password in both PostgreSQL URLs in memory and never prints credential
contents.
