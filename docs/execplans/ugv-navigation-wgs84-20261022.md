# ExecPlan: navigate to the user supplied WGS84 point

## Scope and evidence

The user requested a live MCP navigation to longitude 106.81307318, latitude
29.71952521. Evidence is in
`/mnt/data/ugv-navigation-20261022-10681307318-2971952521`.

The first invocation is durably TECHNICAL_FAILED / UGV_PLANNER_TIMEOUT, with no
downstream mission IDs. Its idempotency key and execution identity are preserved.
The planner is reachable and returns candidates. The running dashboard's toGnss
uses south-positive world Y. A fresh GNSS/nav-state pair independently confirms
the sign. The adapter's old plus sign reflects the start and rejects those routes.

## Steps

- [x] Read fresh state, exact-target availability and active ownership; preserve
      the unrelated unresolved EO stop and all history.
- [x] Diagnose the original request without replaying its invocation.
- [x] Isolate a minimal planner transform fix on the deployed Adapter source;
      do not include the separately prepared recon deadline change.
- [x] Test independent field coordinates, outgoing points, geometry rejection,
      planner and navigation lifecycle; typecheck, lint and build.
- [ ] Update only the local Adapter with identical configuration and mounts;
      confirm fresh connectivity and no pending chassis dispatch.
- [ ] Submit one new navigation after the original has conclusively failed;
      record native mission, movement and arrival or the exact failure.

Validation: 118/118 navigation regressions passed; typecheck, targeted lint and
build exited 0. A planning-only probe of the real source selected 11 real points
in 405 ms, with start 106.81270530589047/29.720283288943193 and final point
106.81307947781141/29.719532126872906. No mission was created by this probe.

## Rollback

Restore Adapter image smpp-recovery/adapter:20261022-beb2332. Preserve task records,
database volumes, bindings, signing keys, PMS settings and uncertain EO ownership.
Do not replay either navigation key or weaken route validation to obtain success.
