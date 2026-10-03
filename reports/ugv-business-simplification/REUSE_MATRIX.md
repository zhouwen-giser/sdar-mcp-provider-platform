# v1.3 reuse matrix

| Area                                                                    | Decision       | Implementation path / boundary                                                                                  |
| ----------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------- |
| Frozen MCP, Task/command lanes, durable input inbox                     | REUSE + CHANGE | Add server-issued development policy provenance to existing internal envelopes; keep public JSON unchanged      |
| Other authentication modes                                              | REUSE          | Preserve authenticated responder checks and reject caller-supplied authority                                    |
| GOWM and PostgreSQL stores                                              | REUSE          | Existing JSON command payloads; no new schema/table/session service                                             |
| Navigation planner, route adoption and adjustments                      | REUSE + CHANGE | Remove execution-mode gate, retain configured planner, entity and business-store requirements                   |
| UGV execution mode defaults                                             | CHANGE         | Live by default throughout configuration/runtime/deployment; explicit simulation remains                        |
| Recon association                                                       | REUSE + AUDIT  | Existing unique active execution resolver, strict explicit identity, fresh/non-retained post-start observations |
| Provider AutoLock and RequiredInput                                     | REUSE + CHANGE | Keep observed stage and target/session guards; allow development policy responder                               |
| Native status semantics                                                 | CHANGE         | Thin shared projection with codebook evidence and unknown fallback; additive output fields                      |
| Guide and deployment examples                                           | CHANGE         | Default live and development no-identity behavior, semantic/native relationship                                 |
| SDK, RBAC, multi-device routing, recon.adjust_area, new sessions/tables | OUT_OF_SCOPE   | No implementation added                                                                                         |
| Device/isr-simulation changes and weapons enablement                    | OUT_OF_SCOPE   | No upstream changes; fire remains disabled                                                                      |

Validation will distinguish local live-mode integration (controlled device fixtures), database-backed wire tests, historical field evidence and new field runs. A live execution-mode flag alone is not evidence of a real device run.
