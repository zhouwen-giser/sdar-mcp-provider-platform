# Goal 10 PMS Console addendum — final qualification report

## Result

`PMS_CONSOLE_PACKAGE_QUALIFIED`

All acceptance Gates A–K passed at qualification HEAD `7ca09d55aaf01dab9d6711fdd793530084897868`. The broader real-UGV integration still records upstream MQTT topic/QoS drift; that limitation does not block the PMS Console package gates.

## Revision baseline

| Field                    | Value                                         |
| ------------------------ | --------------------------------------------- |
| Branch                   | `codex/goal-10-ugv-simulation-real-interface` |
| Addendum start HEAD      | `c70d45ee117015db7571d8330025f8dc9096f3f5`    |
| Final/qualification HEAD | `7ca09d55aaf01dab9d6711fdd793530084897868`    |
| Start state              | clean; 0 tracked changes; 0 untracked files   |
| Push or PR               | none                                          |

Existing Goal 10 work was preserved. Frozen PMS contract, protocol, PMS domain/persistence/migrations, and UGV implementation paths have no addendum diff outside the approved transport, Web, and packaging scope.

## Gate results

| Gate                           | Result | Evidence summary                                                                                                                                         |
| ------------------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A — Existing Goal 10 protected | PASS   | No reset/clean/stash/rebase; protected-path diff empty.                                                                                                  |
| B — Frozen contract unchanged  | PASS   | v1.0.0 remains frozen: 36 operations, 28 schemas, 15 examples, 32 problem codes; all four lock hashes match.                                             |
| C — PMS API validated          | PASS   | Full API suite, typecheck, lint, build, conformance, production composition, config E2E, migrations, registry E2E, and legacy regression passed.         |
| D — PMS Web real API mode      | PASS   | 36/36 HTTP Gateway operations; API mode fails closed; no mock fallback; ProblemDetails and opaque cursors preserved.                                     |
| E — Web proxy boundary         | PASS   | Only `/api/console/v1/**` forwards; machine and arbitrary `/api/**` routes are locally blocked; size/timeout/abort/header boundaries passed.             |
| F — Web + API E2E              | PASS   | Real browser → Web → API → isolated PostgreSQL 17; all main read families and one safe synthetic provider write passed.                                  |
| G — Unified PMS Console        | PASS   | `pms-postgres`, `pms-api`, `pms-worker`, and `pms-web` ran healthy.                                                                                      |
| H — Exact revision             | PASS   | API, Worker, and Web OCI revisions all equal the final HEAD.                                                                                             |
| I — Clean deployment           | PASS   | Pre-start inventory proved 0 matching containers/volumes; fresh-state deployment and volume-preserving restart both passed automatic and explicit smoke. |
| J — Final Goal 10 compose      | PASS   | Eight persistent PMS/UGV services integrated; simulator, Device MCP, and MQTT remain external; no mocks introduced.                                      |
| K — No secrets                 | PASS   | No committed password, token, Authorization value, TLS private key, simulator endpoint, or simulator secret.                                             |

## PMS API evidence

- Frozen Console operations: 36 expected, 36 registered, 0 missing, 0 extra.
- Full `@sdar/pms-api` suite: 32 files / 132 tests passed against isolated PostgreSQL 17.
- Production composition: 1 file / 4 tests passed.
- Additional database gates: PMS 5/23, config 3/16, config E2E 1/8, migrations 2/9, registry E2E 1/4 — all passed.
- Typecheck, lint, build, conformance, legacy route regression, all-operation success cases, request validation, and redacted unexpected-error handling passed.
- OpenAPI SHA-256: `dddf9a6c9a5d8264b71aa11495106e197857e186b02fd8e54fc0f0a53e33f042`.
- Schema bundle: `a0982fd32dd5647831b528571fbee3972eac29ee0e8f7295b960e0507bf4ab1a`; endpoint map: `1ebf9c52c29044a0c14d19d73841a1822559a1d1ddef72f4abe399569ff1a396`; error map: `3b72501425815462f7bbc11e5b080dc3baab3677bcea82d5701840d755ca2b6b`.

## PMS Web evidence

- Real API mode: PASS; browser base `/api/console/v1`; no mock provider truth or mock fallback.
- Web suite: 12 files / 44 tests passed; package and repository typecheck/lint and API-mode build passed.
- Proxy boundary suite: 7/7 passed.
- Browser E2E: 1/1 passed in 8.3 seconds, including six read families, a safe synthetic `draft → active` provider transition, ProblemDetails rendering, and blocked machine-registration route.
- `job_lease` remained 0 before and after; no Worker control job or real UGV write was triggered.

## Images and deployment

| Service    | Qualified image                                            | OCI revision                               |
| ---------- | ---------------------------------------------------------- | ------------------------------------------ |
| pms-api    | `sdar/pms-api:7ca09d55aaf01dab9d6711fdd793530084897868`    | `7ca09d55aaf01dab9d6711fdd793530084897868` |
| pms-worker | `sdar/pms-worker:7ca09d55aaf01dab9d6711fdd793530084897868` | `7ca09d55aaf01dab9d6711fdd793530084897868` |
| pms-web    | `sdar/pms-web:7ca09d55aaf01dab9d6711fdd793530084897868`    | `7ca09d55aaf01dab9d6711fdd793530084897868` |

All three images run as the non-root `node` user and have health checks. The Worker includes executable Runtime release `2.0.0-rc.1`, immutable release content, and UID 1000 state roots with mode `0700`.

- Standalone compose: `deploy/pms-console/compose.yaml`
- Standalone one-click command: `bash deploy/pms-console/up.sh`
- Final UGV compose: `deploy/ugv-simulation/compose.yaml`
- Final UGV one-click command: `bash deploy/ugv-simulation/up.sh`

At handoff, the integrated stack remains running with eight persistent services and three isolated PostgreSQL 17 services. Real external preflight connected to Device MCP and MQTT with mock fallback disabled; read-only Runtime smoke passed all four safe operations.

## Safety and limitations

No movement, navigation, reconnaissance, gimbal, target-lock, effector, MQTT publish, or other real control action was attempted. No coordinates, raw external payloads, endpoint values, or secrets are retained in evidence.

The live simulator exposed compatibility topic `/ugv/status` instead of observed canonical `status/ugv`, and `/ugv/speed` arrived at QoS 0 rather than expected QoS 1. The preflight therefore remains `PASS_WITH_UPSTREAM_DRIFT`; see `KNOWN_LIMITATIONS.md` for the fresh-state command audit, source-integrity behavior after evidence generation, and deployment-profile boundaries.

## Delivery

- ZIP: `delivery/goal10-pms-console-addendum-delivery.zip`
- ZIP SHA-256: `delivery/goal10-pms-console-addendum-delivery.zip.sha256`
- Patch: `delivery/goal10-pms-console-addendum.patch`
