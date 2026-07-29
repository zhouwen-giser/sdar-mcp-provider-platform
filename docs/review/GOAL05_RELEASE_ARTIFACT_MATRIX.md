# Goal 05 Release Artifact Matrix

The `release-artifacts` job qualifies local, immutable `0.1.0-rc` images without
publishing them. Image publication remains exclusive to the approved tag
release workflow.

| Artifact   | Built target | Runtime assertion                                                       | Content policy                                                                    |
| ---------- | ------------ | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Runtime    | `runtime`    | non-root image inspected                                                | compiled runtime, migrations, protocol; no dependency source maps or test secrets |
| PMS API    | `pms-api`    | migrations, package registry, readiness                                 | compiled packages and production dependencies only                                |
| PMS Worker | `pms-worker` | controlled Compose start and independent safe-stop smoke                | PMS/Runtime migrations, provider packages, protocol                               |
| PMS Web    | `pms-web`    | HTML, JS, CSS, SPA fallback, health, API reachability, security headers | repository-built static assets only                                               |

`reports/ci/release-artifacts.json` records content-addressed image identity,
size, runtime UID, and OCI labels. It contains no credentials, container logs,
temporary paths, environment dumps, or database URLs.

The smoke command owns one validated Compose project and one matching directory
under the operating-system temporary directory. Its `finally` path and the
workflow's `if: always()` step both run the same idempotent cleanup command,
which removes only resources carrying that exact Compose project label.
