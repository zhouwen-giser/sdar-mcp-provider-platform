# Goal 04 production lifecycle test matrix

`pnpm test:worker-pm2-production` is a controlled production-path qualification gate. It uses real
local PostgreSQL and the repository-pinned PM2 JavaScript API, but it is not real-provider
certification.

| Lifecycle assertion        | Production path exercised                                                                                                                                             | Fail-closed evidence                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Initial convergence        | PMS API intent → Scheduler → fenced Worker claim → database/role provisioning → Runtime migrations → secure bootstrap → PM2 → health → discovery → Catalog → Registry | Deployment becomes `ACTIVE` only after Registry publication                                 |
| Provider identity mismatch | Built mock adapter advertises a different Provider ID while the built Runtime is online                                                                               | Deployment remains `DEGRADED` and never becomes `ACTIVE`                                    |
| Runtime crash recovery     | `SIGKILL` of the PM2-managed Runtime followed by normal periodic reconcile                                                                                            | `ACTIVE → DEGRADED → ACTIVE` with a new PID                                                 |
| Adapter outage recovery    | Built adapter is stopped and restarted without changing desired state                                                                                                 | Adapter outage is not `ACTIVE`; recovery returns to `ACTIVE`                                |
| Worker outage              | Production Worker Composition is stopped with bounded lease shutdown                                                                                                  | Runtime remains online                                                                      |
| PMS API outage             | Production PMS API Composition is stopped and restarted                                                                                                               | Runtime remains online and resumes control-plane registration                               |
| Configuration drift        | A second validated Runtime config revision is published through the PMS API                                                                                           | Exactly one controlled PM2 restart applies revision 2                                       |
| Lease fencing              | An expired lease is reclaimed with a higher fencing token                                                                                                             | Stale completion is rejected with `LEASE_NOT_OWNED`                                         |
| Registry consumer          | Active Registry snapshot resolves the Runtime endpoint for a controlled catalog consumer                                                                              | Consumer discovery uses Registry authority rather than a direct fixture endpoint            |
| Cleanup                    | Production PM2 process manager plus explicit temporary PostgreSQL/file cleanup                                                                                        | No Runtime process, temporary database/role/schema, PM2 home, credential, or secret remains |

The gate consumes the built Runtime entry
`dist/apps/runtime/src/main.js` from a fixed versioned release directory and the built local Mock
Provider Adapter. PMS API and Worker are instantiated from their production composition factories.
The test uses a short isolated `PM2_HOME` because PM2 uses Unix-domain sockets whose platform path
limit is substantially lower than the application's general filesystem path limit.

Redacted machine-readable evidence is written to
`reports/evidence/G4-P3-B01-worker-pm2-production.json`.
