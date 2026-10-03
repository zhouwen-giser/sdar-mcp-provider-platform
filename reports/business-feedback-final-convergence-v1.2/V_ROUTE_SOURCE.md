# Existing route source: real public navigation PASS

The existing airport `plan_route` / `route_candidates` source is integrated with
Device MCP path creation and mission start. Only SMPP code changed. Exact selected
geometry is persisted and submitted with `need_plan=false`; a candidate becomes
adopted only after fresh non-retained raw mission-state 1 for the journaled mission.
The source has no request ID, so endpoint/ordered-via matching and the declared
20 m airport road-snap tolerance constrain selection; no request-ID correlation is
claimed. Source identifiers are content fingerprints, not device-issued IDs.

Real Provider prevalidation: missions 47549 → 47550 → 47551 passed two adjustments
and arrival. This earlier Provider-only run is separate evidence, not public-wire
or same-final-candidate qualification (`evidence/navigation-provider-source.json`).

Final public Runtime run: Task `8a3d2d0b-5cf7-4e07-96a8-193b3cad6267`, missions
47564 → 47565 → 47566, plan revisions 1 → 2 → 3, final `completed`/`SUCCEEDED`.
Destination 106.81312856, 29.72041222; final distance 1.454523 m, speed 0 km/h,
stationarity confirmed. Public Context/Artifact/trajectory snapshots, guarded
Interventions and SSE used the production Provider and Runtime entrypoints,
JWT authentication, and an isolated complete GOWM SMPP installation/app role.

The final run also restarted both OS processes between adjustments. The mutation
journal did not change during restart, and public reads recovered plan revision 2.
SSE applied 15 initial and 39 recovered-window business events without probe error.
See `evidence/navigation-public-restart.json` and `evidence/navigation-summary.json`.
This is local Runtime + real software-source evidence, not sz-gowm deployment,
external SDAR consumption, a verified simulator build or all four workflows.
