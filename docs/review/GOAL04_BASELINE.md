# Goal 04 production lifecycle baseline

## Locked integration point

- Work branch: `codex/goal-04-production-lifecycle-closure`
- Integration branch: `origin/codex/goal-03-merge-readiness-foundation`
- Integration SHA and merge-base:
  `039843ffc3d9e57017d6015261899927d074168a`
- Goal 04 activation commit: `f2b17b5`
- Goal 03 task state: 7 tasks, all `PASSED`

Goal 03 supplies the clean frozen-protocol, Docker, dependency-audit, PMS API,
single reconcile-owner, and deployment-state convergence baseline. Its original
task state, handoff, and test evidence are protected by
`.codex/goal-04/prior-state-baseline.json`.

## Toolchain and host

| Component         | Observed value                                     |
| ----------------- | -------------------------------------------------- |
| Node.js           | `v22.23.1`                                         |
| pnpm              | `11.13.1`                                          |
| PostgreSQL        | `17.10`, task-owned Compose instance               |
| Docker            | `29.6.1`                                           |
| Docker Compose    | `5.3.1`                                            |
| Git               | `2.34.1`                                           |
| Host              | Linux `6.8.0-124-generic`, `x86_64`                |
| PM2               | no global or workspace-pinned executable available |
| Required PM2      | repository-pinned `7.0.3`                          |
| Runtime component | `2.0.0-rc.1`                                       |
| Platform root     | currently `2.0.0-rc.1`; Goal 04 target is `0.1.0`  |

## Fresh baseline verification

The baseline was rerun from a clean PostgreSQL volume:

- `pnpm install --frozen-lockfile`: passed for all 42 workspaces.
- `pnpm verify:v2`: passed, including frozen conformance 74/74, strict audit
  with no high/critical findings, 275-component SBOM, 99,659,358-byte
  reproducible Runtime image, unit 123, contract 18, integration 212, recovery
  9, security 42, E2E 8, and RC regression 6 tests.
- `pnpm test:pms-api-production`: 1 file / 3 tests passed.
- Docker workspace verifier: 41 required / 41 staged.
- `docker compose config -q` and Runtime/TypeScript Adapter builds: passed.
- PMS Worker: 4 files / 12 tests passed.
- PM2 Runtime Adapter: 6 files / 37 tests passed.
- Prior-goal hash verification and `git diff --check`: passed.

The controlled Business Events interop gate continues to record that a real
external SDAR is unavailable; it does not claim external certification.

## Production path inventory

### PM2

- `Pm2ProcessManager` and `RuntimeLifecycleManager` already expose bounded
  application-facing lifecycle contracts.
- `Pm2JavascriptApi` is only an interface; no production factory binds it to
  the PM2 package.
- `@sdar/pm2-runtime-adapter` does not depend on PM2.
- The existing real test calls `pnpm dlx pm2`, bypassing the production
  manager and allowing network-time tool acquisition.
- An online process is currently treated as unchanged without comparing
  Runtime Version, Config Revision, or Bootstrap Checksum.

### PMS Worker and scheduler

- Production bootstrap creates PostgreSQL repositories and migrations, but
  registers only `provider_package.sync`.
- The `runtime_deployment.reconcile` handler exists and is covered in
  isolation, but is not part of the production composition root.
- Worker configuration contains only database, lease, polling, retry, and
  workspace settings; secure release, bootstrap, secret, PM2, health, identity,
  and scheduler inputs are absent.
- No periodic database-time scanner restores missing reconcile jobs.

### CI and release

- CI has `runtime-ci`, `pms-api-production`, and `runtime-compose`; it lacks a
  production Worker/PM2 lifecycle job and final platform qualification.
- Root package version still identifies the Runtime RC.
- `reports/platform-v0.1/RELEASE_MANIFEST.json` contains the placeholder
  `commit-containing-this-manifest` and stale Goal 2 source metadata.
- Platform checksums and handoff must be regenerated only after the production
  path and final gates are complete.

## Remaining bounded blockers

1. Pin PM2 and add the bounded JavaScript API bridge.
2. Detect non-secret Runtime configuration drift and qualify the real product
   path.
3. Harden Worker configuration and add database-backed periodic scheduling.
4. Assemble the complete production lifecycle without creating a second
   reconcile owner.
5. Prove Worker-to-Runtime convergence and recovery with real PostgreSQL, real
   PM2, the built Runtime, and the formal composition root.
6. Add final CI qualification and replace release placeholders without
   creating a tag or merging `main`.
