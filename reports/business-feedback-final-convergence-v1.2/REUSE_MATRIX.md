# BFF-001 reuse matrix

| Component                                             | Decision                  | Current source / remaining work                                                                                                   |
| ----------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Business schemas and reducer                          | REUSE                     | packages/mcp-protocol/src/task-business-feedback.ts; packages/vehicle-provider-core/src/task-business-*.ts                        |
| Version Store / command ledger / atomic source events | REUSE                     | packages/provider-adapter-kit/src/postgres-task-business-store.ts; do not create another store                                    |
| Public Runtime Context / Artifact / Snapshot / SSE    | REUSE                     | existing read-only-probe and Runtime gateway                                                                                      |
| Navigation processor / trajectory                     | EXTEND                    | apps/ugv-provider-adapter/src/navigation-business-processor.ts lacks qualified production route/adoption ingress                  |
| Recon / target / native lock projection               | EXTEND                    | corresponding apps/ugv-provider-adapter/src/*business-processor.ts; source mission identity missing                               |
| Provider automatic visual lock                        | IMPLEMENTED / UNQUALIFIED | coordinator and journal dispatch implemented; 25 synthetic Runtime tests; real source identity still blocks qualification         |
| Manual input handler / trusted responder              | REUSE + EXTEND            | manual-input-business-handler.ts; production qualification gate remains closed                                                    |
| UGV intervention                                      | EXTEND                    | runtime.ts applyIntervention still rejects RUNNING with UGV_INTERVENTION_NOT_SUPPORTED                                            |
| GOWM consumer / owner template                        | EXTEND + BLOCKED          | strict open exists; owner business migration/contract absent; current remote marker SELECT already granted; strict suite extended |
| Input/intervention probes                             | REUSE                     | scripts/task-business/{manual-input,intervention,read-only}-probe.ts                                                              |
| Unified manual acceptance CLI                         | ADD                       | implemented public probe composition, discover-first reads and explicit guarded writes                                            |
| External SDAR consumption                             | BLOCKED                   | no same-candidate consumer evidence                                                                                               |
