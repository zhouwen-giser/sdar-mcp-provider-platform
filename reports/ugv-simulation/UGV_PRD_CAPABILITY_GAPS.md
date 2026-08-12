# UGV PRD capability gaps

Qualified product: `e1473ea6c7ea61ef0495e85cf19b6f7256143791` (`TRACKED_SOURCE_CLEAN`)

Evidence cut: `2026-08-10T07:29:39.362Z`

Overall: `UGV_SIMULATION_PARTIAL`

Provider Package `realResourceStatus`: `pending`

These are explicit capability gaps, not candidate fake Provider tasks. The real `ugv-mcp-server` `1.26.0` exposed the same 15 tools as the supplied protocol; its captured inventory has SHA-256 `9f4cca36aaacbe649ede430d4c1d1d5d079b27c9ec784317a0250eb952679519`. None of the absent capabilities below has a matching live device primitive.

| PRD capability                                       | Live evidence-backed status                                                                       | Classification         | Provider treatment                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------------------------------- |
| chassis power on/off                                 | no matching primitive in live 15-tool inventory                                                   | `MISSING_ON_SIMULATOR` | do not expose or synthesize                                                                                 |
| EO payload power on/off                              | no matching primitive in live 15-tool inventory                                                   | `MISSING_ON_SIMULATOR` | do not expose or synthesize                                                                                 |
| radius/angle chassis turn                            | no direct turn primitive; live tools provide path, return-home, and directional distance missions | `MISSING_ON_SIMULATOR` | retain point/route/distance abstraction; do not fake a turn command                                         |
| brightness control                                   | no matching gimbal field or separate live tool                                                    | `MISSING_ON_SIMULATOR` | omit from the bounded gimbal task                                                                           |
| focus control                                        | no matching gimbal field or separate live tool                                                    | `MISSING_ON_SIMULATOR` | omit from the bounded gimbal task                                                                           |
| image/video capture command                          | no live capture tool; screenshot/video transport is not a command primitive                       | `MISSING_ON_SIMULATOR` | do not treat MQTT screenshot or RTP/WebRTC endpoints as capture tasks                                       |
| laser range                                          | optional `ugv_laser_range` extension is absent from live `tools/list`                             | `MISSING_ON_SIMULATOR` | keep `vehicle_laser_range` capability-gated and fail closed; never substitute mock data                     |
| capability values not returned by `get_capabilities` | the real read succeeded, but only actually reported fields are authoritative                      | `COMPATIBLE_MAPPING`   | preserve `deviceReported`; never fabricate range, turning radius, communications range, or obstacle ability |

## Qualification gaps distinct from product capability gaps

- Canonical MQTT `status/ugv` was not observed; the upstream simulator published `/ugv/status`. The product supports the alias, but this remains `SEMANTIC_MISMATCH` evidence rather than canonical-topic PASS.
- `/ugv/speed` was published at QoS 0 while the supplied protocol requires QoS 1. The product subscription remains QoS 1, and the upstream drift remains unresolved.
- Real control was disabled. Distance, return-home, pause/resume/cancel, gimbal, and emergency-stop mappings were not exercised against the real device.
- Point and route navigation lacked safe fixtures. Reconnaissance was disabled and no safe region was configured.
- PMS onboarding/Registry authority and real effector execution were not run. Effector tests remained disabled.
- Six subscribed event/reconnaissance topics produced no bounded sample. Canonical `status/ugv` was also absent, for seven unsampled subscriptions in total; parser coverage is not live payload proof.
- All live MCP tools omit `outputSchema` and annotations. Local strict validators reduce risk but do not make those server contract fields present.

The Agent continues to own planning, multi-source arbitration, geographic memory, mission history/replay, autonomous anomaly decisions, coordination, and offline backfill. No Provider operations are added for those responsibilities.

Evidence references: `REAL_EXTERNAL_PREFLIGHT.json` (`c169836e…ffcd`), `REAL_EXTERNAL_PREFLIGHT.compose-cycle2.json` (`89c8a689…96e1`), `READ_ONLY_SMOKE.cycle1.json` (`7ba6c377…ca3b`), and `READ_ONLY_SMOKE.json` (`59336e2a…14de7`). Endpoints, credentials, and raw payloads are intentionally excluded.
