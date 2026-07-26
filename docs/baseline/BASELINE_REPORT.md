# Offline Delivery Baseline Report

## Result

The fixed offline source archive is verified.

- Archive: `sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip`
- Expected and observed SHA-256: `000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`
- Archive size: 3,206,351 bytes
- Delivery files: 803
- Canonical project-tree SHA-256: `fde5b26b671b6f1d6143c1ef81cb0d24b01c1b77de8acb5b0d35992867e57ca3`
- Delivery manifest: schema `1.0`, generated `2026-07-23T03:25:02Z`

The verification was performed with:

```text
bash .codex/task-package/scripts/verify_source_baseline.sh
Source baseline OK: 000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3
```

## Imported tree inventory

| Category        | Count | Notes                                                                                   |
| --------------- | ----: | --------------------------------------------------------------------------------------- |
| Applications    |     8 | Direct child directories of `apps/`                                                     |
| Packages        |    13 | Direct child directories of `packages/`                                                 |
| Migrations      |    26 | SQL files in `migrations/`; numbering spans 001–025 and contains two distinct 014 files |
| Tests           |   125 | Files matching `tests/**/*.test.ts`                                                     |
| Test assets     |   131 | All files below `tests/`, including fixtures                                            |
| Protocol assets |    34 | All files below `protocol/`                                                             |

The application, package, Migration, and test-suite breakdown is recorded in
`BASELINE_INVENTORY.json`.

## Version baseline

The root project is `sdar-mcp-tasks-provider-runtime` version `2.0.0-rc.1`.
It declares Node.js `>=22 <23`, pnpm `>=11 <12`, and
`pnpm@11.13.1`. The observed Node.js `v22.23.1` and pnpm `11.13.1`
satisfy those constraints. The observed supporting tools are Python `3.10.12`
and Git `2.34.1`.

## Delivery manifest interpretation

`WORK_DELIVERY_MANIFEST.json` records 11 historical PASS entries and 3
historical `PARTIAL_ENVIRONMENT_BLOCKED` entries. Those entries are delivery
provenance, not tests rerun by this inventory task. No product source was
changed and no historical assertion was promoted to fresh evidence.

## Environment availability

- `TEST_DATABASE_URL` is not configured.
- Docker CLI `29.6.1` and Docker Compose `v5.3.1` are installed.
- The Docker daemon is not reachable because access to
  `/var/run/docker.sock` is denied.
- `psql` and `pm2` are not installed.

These observations do not block this static baseline task. Later cards must
still use unit, fake-adapter, static, or available local PostgreSQL validation
before applying the task package's external-blocker rules.
