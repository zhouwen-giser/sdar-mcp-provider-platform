# Goal 05 Worker lease safety matrix

The focused qualification gate runs two real `PmsWorker` instances against one PostgreSQL PMS
schema and the production `PostgresJobLeaseRepository`. Only the designated Worker A renewal call
is fault-injected; lease expiry, claims, fencing, completion, failure, and state queries remain
authoritative PostgreSQL operations.

| Scenario               | Worker A                                                                           | Worker B                              | PostgreSQL proof                                                   |
| ---------------------- | ---------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------ |
| A: continuous renewal  | Handler runs longer than three initial leases and renews independently             | Polls but never claims                | Fence remains `1`; exactly one succeeded row                       |
| B: renewal loss        | Renew fails, Signal aborts, no complete/fail                                       | Claims after expiry                   | Fence advances from `1` to `2`; exactly one succeeded row          |
| C: uninterruptible SQL | Loses lease during `pg_sleep`, checks Signal after return, performs no later write | Takes over and writes the sole marker | Only B's fence-`2` marker exists                                   |
| D: claim limit 3       | Three long handlers start together and renew independently                         | Polls but never claims queued work    | All three rows succeed at fence `1`; no pending/leased/failed rows |

The gate creates no PM2 process, temporary database, or token file. Its isolated schema and both
Workers are cleaned in `finally`. Evidence contains only counts, fences, public timing parameters,
and boolean assertions.
