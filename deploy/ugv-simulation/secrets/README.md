# Secret files

Create secret files **outside the repository** and reference their absolute paths from `deploy/ugv-simulation/.env`. Never copy live credentials into `.env.example`, Compose YAML, reports, or shell history. `up.sh` fails if another file is placed in this directory so that a credential cannot accidentally enter the Docker build context. Before Docker runs, `up.sh` and `smoke.sh` reject relative paths, repository-contained paths, directories, symlinks, unreadable files, and permission bits broader than `0600`; `.env` is parsed as data and is never sourced.

Supported files:

- `UGV_SIM_DEVICE_MCP_HEADERS_FILE`: a UTF-8 JSON object whose keys and values are HTTP header strings, for example an authorization header. Maximum 16 KiB.
- `UGV_SIM_MQTT_PASSWORD_FILE`: one MQTT password followed by an optional newline. Maximum 8 KiB.
- `UGV_SIM_MQTT_TLS_CA_FILE`: PEM CA bundle.
- `UGV_SIM_MQTT_TLS_CERT_FILE`: PEM client certificate.
- `UGV_SIM_MQTT_TLS_KEY_FILE`: PEM private key.

Restrict each file to its owner before use:

```bash
chmod 600 /absolute/path/to/the-secret-file
```

Compose mounts these values as read-only files under `/run/secrets`; secret content is never copied into evidence. Git also ignores unrecognized files here as a secondary defense, but the external-file rule remains mandatory.

## PMS Console secret root

The integrated stack also requires `PMS_CONSOLE_SECRET_ROOT`. It is a single absolute directory
outside the repository; do not place any PMS file in this documentation-only directory. Prepare
the exact `postgres-password`, database URL, empty deferred-auth descriptors, PostgreSQL
provisioning descriptor, and Runtime control-plane directory documented in
[the standalone PMS Console secret guide](../../pms-console/secrets/README.md).

The PMS preflight enforces the same non-symlink, ownership, permission, hostname, database, and
password-consistency rules in both the standalone and integrated stacks. The PostgreSQL password
is mounted through a Compose secret; the API and Worker credential/configuration files are mounted
read-only and are never exposed through the browser-facing service.
