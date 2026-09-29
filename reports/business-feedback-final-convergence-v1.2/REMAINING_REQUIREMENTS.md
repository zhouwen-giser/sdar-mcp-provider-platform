# Requirement audit after real navigation and active recon inspection

The Goal is incomplete. The current evidence proves the local navigation branch
and selected GOWM persistence; it does not prove all four workflows on one final
candidate. The original GOAL.md, ACCEPTANCE.md and all 22 task cards remain the
completion criteria. Both global completion flags stay false.

| Cards       | Requirement and evidence                                                                                                                             | Result / remaining work                                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| BFF-001–003 | Existing worktree retained; baseline/reuse/core/GOWM selection recorded; real tools and MQTT inspected in DEVICE_SOURCE_MATRIX.md                    | Baseline evidence present; current source limits are explicit                                                                            |
| BFF-004–007 | Actual planner, candidate/adopted facts, production ingress/profile, public route/trajectory/terminal; V-NAV.json and navigation-public-restart.json | Local real navigation PASS; full Goal still needs a final shared candidate                                                               |
| BFF-008     | Current status/targets/lock identity and reset isolation; recon-active-source-recheck.json                                                           | BLOCKED: active messages remain anonymous; receipt mission and coverage run_id cannot supply a shared reset-safe identity                |
| BFF-009     | Provider-only observational auto-lock, once-only journal, ACK distinct from stage 3, pause/cancel priority                                           | Component implementation/tests present; real source qualification blocked by BFF-008                                                     |
| BFF-010     | Trusted RequiredInput, current lock session, continue/release/expiry and scanning recovery                                                           | Handler/tests present; production qualification blocked by BFF-008/009                                                                   |
| BFF-011     | Selected core branch; distinguish requested area, cumulative coverage and current footprint                                                          | mapFull=false and footprint disabled; no map-full qualification claimed or required by this selection                                    |
| BFF-012     | Real V-OBS and V-INPUT through public Runtime plus independent device observations                                                                   | NOT_RUN; explicit V-OBS.json/V-INPUT.json identify prerequisite and safely stopped source audit                                          |
| BFF-013–017 | Existing controlled mission replacement, command ledger, effective intent, candidate/application distinction, two successive edits                   | Local real V-EDIT PASS; immutable arguments, current terminal mission and full process restart recorded                                  |
| BFF-018     | Selected GOWM owner install, schema/grants, exact versions, idempotency, atomic rollback, scope isolation, recovery                                  | 9 strict Store tests, 7 deployment SQL tests and real public restart passed; no remote installation claimed                              |
| BFF-019     | Discover-first bounded manual probe, default read-only, explicit guarded writes, no weapons                                                          | Tests and actual public navigation use pass; same-candidate recon/input use still missing                                                |
| BFF-020     | Real Context/SSE/Input/Intervention consumer handoff and external SDAR                                                                               | Eight complete navigation payload exports and offline replay pass; Input/recon remain absent, external SDAR EXTERNAL_PENDING             |
| BFF-021     | Existing CI job/aggregate including new UGV and selected persistence checks; other Provider compatibility                                            | Local UGV285/native26/GOWM9/deployment7/manifest15, static/build/protocol checks pass in VALIDATION.md; no hosted final candidate result |
| BFF-022     | Legacy mapping and all four same-candidate workflows, selected storage, required core capability and final CI                                        | INCOMPLETE: V-OBS/V-INPUT and final same-candidate validation missing; END_TO_END additionally needs external SDAR                       |

The final Context archives an unused third adjustment under summary properties;
this is separate from missing object hydration. The exported final snapshot has
no unresolved hydration refs, empty activeRefs and finalized status. No raw wire
messages, nonempty targets, Input decisions or external consumer results were
invented to fill missing evidence.

The user permits SMPP changes and packaged SQL, and disallows isr-simulation
changes. A producer-supplied identity/generation or independently verifiable
reset-safe mapping is the concrete prerequisite for proceeding with BFF-008–012.
No device mutation can create that producer contract inside SMPP. The present
source audit already exercised the active state and proper recon stop; repeating
it unchanged is not further implementation progress.
