# Goal 2 Phase P3 — PM2 and Runtime reconciliation gate report

- Phase: `P3 PM2 and Runtime reconciliation`
- Status: `PASSED`
- Closing task: `G2-P3-B12`
- Git commit: this report commit
- Tasks passed: `G2-P3-B01` through `G2-P3-B12`
- External environment gaps: none for P3 acceptance; an isolated real PM2 daemon, the built SDAR
  Runtime, a mock Adapter, and controlled local PostgreSQL supplied the component E2E.
- Qualification boundary: this is real PM2/Runtime component evidence, not real Provider resource
  authentication and not Provider Interop Certified.

## Scope delivered

P3 delivers an infrastructure-neutral Runtime adapter port, deterministic and SecretRef-only
bootstrap rendering, callback-compatible PM2 process management, fixed release resolution, stable
instance allocation, idempotent process lifecycle orchestration, process-plus-HTTP health probes,
platform identity bootstrap, desired/observed reconciliation, bounded crash recovery, graceful
draining and shutdown, all-stop Task Authority database switching, and a real PM2 closeout E2E.

PM2 remains constrained to the fixed built Runtime entry, release-root cwd, fork mode, one process,
platform process namespace, bounded restart and memory policy, bounded graceful shutdown, and an
explicit environment allowlist. PM2 `online` is never treated as sufficient for Runtime `ACTIVE`;
live, ready, identity, and discovery checks remain separate reconciliation stages.

## Task ledger

| Task | Result | Commit | Primary evidence |
| --- | --- | --- | --- |
| `G2-P3-B01` | PASSED | `8ed09bd` | infrastructure-neutral Runtime adapter port |
| `G2-P3-B02` | PASSED | `0e61e1c` | deterministic bootstrap and Secret file references |
| `G2-P3-B03` | PASSED | `fba0c81` | PM2 JavaScript API wrapper and namespace enforcement |
| `G2-P3-B04` | PASSED | `16a0ab6` | fixed release root, version manifest, and entry validation |
| `G2-P3-B05` | PASSED | `9d65193` | stable identities, bounded ports, and concurrent allocation |
| `G2-P3-B06` | PASSED | `29dfff9` | idempotent start/stop/restart/delete lifecycle |
| `G2-P3-B07` | PASSED | `6811ad0` | PM2 plus fixed loopback live/ready health probe |
| `G2-P3-B08` | PASSED | `7fa329e` | canonical Runtime identity and Secret-file bootstrap |
| `G2-P3-B09` | PASSED | `7b880c1` | desired/observed Runtime reconciliation workflow |
| `G2-P3-B10` | PASSED | `40aa617` | bounded crash recovery and manual intervention state |
| `G2-P3-B11` | PASSED | `fe4bac6` | drain admission, shutdown, kill timeout, DB switch guard |
| `G2-P3-B12` | PASSED | this report commit | real PM2 crash/recovery/health lifecycle evidence |

## Gate results

| Command | Result | Evidence or limitation |
| --- | --- | --- |
| `node tests/pm2-adapter-e2e/run-real-pm2-e2e.mjs` | PASS | semantic equivalent of absent `pnpm test:pm2-adapter-e2e`; real PM2 7.0.3 |
| `pnpm build` | PASS | protocol generation and TypeScript production build |
| `pnpm test:pm2-adapter` | PASS | 6 files, 37 Fake/unit tests |
| `pnpm --filter @sdar/runtime-config-client test` | PASS | 2 files, 14 tests after built-entry resolution correction |
| Real evidence | PASS | `reports/evidence/G2-P3-B12-real-pm2-e2e.json` |

## Real PM2 observations

- PM2 ran in a new temporary `PM2_HOME`, isolated from user and production process namespaces.
- The fixed `dist/apps/runtime/src/main.js` entry reached both `/health/live` and `/health/ready`.
- SIGKILL changed the PID, incremented the PM2 restart count to one, and the restarted Runtime again
  reached both health endpoints.
- Explicit stop reached `stopped`; explicit delete removed the platform process.
- A non-platform sentinel remained `online` before and after platform process deletion, then was
  removed only by explicit test cleanup.
- The database credential was written to a temporary mode-0600 file and passed only through
  `DATABASE_URL_FILE`; neither the JSON evidence nor this report contains its value or path.
- The isolated daemon, temporary Secret file, mock Adapter, Runtime, and sentinel were cleaned after
  the test.

## Failure found and corrected by the real gate

The first built-Runtime attempt exposed unresolved bare workspace imports in compiled Runtime Config
Client output. Two imports were changed to the equivalent repository-relative contract entry so
the fixed `dist` Runtime entry resolves without source-workspace `node_modules` links. The decision
and narrow scope are recorded in `.codex/decisions.md`; hashing and configuration behavior are
unchanged, and the package's 14 tests plus the production build pass.

## Security, recovery, and authority checks

- Arbitrary command, script, cwd, URL, host, and unbounded environment surfaces are absent from the
  production adapter.
- Restart delay, restart count, minimum uptime, memory restart, and kill timeout are range checked.
- Repeated crash observations persist restart counts, become `DEGRADED` during backoff, and become
  `FAILED` with explicit manual intervention at the limit.
- Desired stop states are not treated as crashes, and an online PM2 process is not independently
  promoted to Runtime `ACTIVE`.
- Drain first rejects new MCP invocations, then stops config polling and closes Runtime resources.
  Existing non-terminal Tasks remain in the same Task Authority database for recovery.
- A database profile change is rejected until desired replicas are zero and every Runtime process
  is stopped or absent; rolling Task Authority database switching is forbidden.
- No recovery or lifecycle interface deletes Runtime Task, Command, Scheduler, Recovery, or Outbox
  data.

## Exit conclusion

All twelve P3 task cards pass. Real PM2 evidence covers built Runtime start, inspect, crash restart,
post-restart health, stop, delete, namespace isolation, Secret-file transport, and deterministic
cleanup. P3 is closed without claiming mock Adapter results as real Provider authentication or
system-level interoperability certification.
