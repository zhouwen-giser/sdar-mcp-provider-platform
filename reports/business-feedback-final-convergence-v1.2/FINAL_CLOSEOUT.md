# Final candidate qualification in progress

`SMPP_UGV_BUSINESS_FEEDBACK_IMPLEMENTATION_COMPLETE=false`

`SMPP_UGV_BUSINESS_FEEDBACK_END_TO_END_READY=false`

The operator selected all implemented non-fire capabilities, including the airport estimated Map-full profile. Fire remains disabled. Only SMPP and packaged SQL changed; GOWM and simulator source are untouched.

- Actual public Recon, Provider lock with later same-target stage 3, continue and decline/release: PASS (`evidence/map-full-recon.json`).
- Actual estimated current footprint and device covered-area geometry: PASS. This qualifies a horizontal range-sector estimate, not calibrated visibility.
- Public Map-full replay: 101 complete Contexts, 166 selected notifications and duplicate no-op checks PASS (`evidence/map-full-replay.json`).
- Current core navigation before Map-full changes: PASS with two adjustments, process restart and actual final arrival (`evidence/final-candidate-navigation.json`).
- Map-full navigation: route adoption, two adjustments and restart passed; arrival timed out. Device subsequently reported mobility_blocked=true / mobility_status=1 with throttle 0.4 and speed about 0.01 km/h. Cancelled through public Runtime. Final arrival requires a restored simulator; no success inferred from ACK or route adoption.
- Final local checks: UGV 324, unit 288, selected GOWM 10, native PostgreSQL 27, cross-contract/lock-order 49, configuration 46 and release candidate 23 PASS. Hosted CI, package and site results will be recorded separately.
- External SDAR remains EXTERNAL_PENDING and only gates END_TO_END_READY.

Historical failures and the core-only captures remain evidence of their own candidate/profile. They are not relabelled as final Map-full arrival or site acceptance.
