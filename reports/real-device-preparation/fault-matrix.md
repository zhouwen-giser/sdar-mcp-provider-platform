# SMPP real-device fault matrix

| Fault area                   | Scenario                                                     | Evidence            | Status                          | Notes                                                                                    |
| ---------------------------- | ------------------------------------------------------------ | ------------------- | ------------------------------- | ---------------------------------------------------------------------------------------- |
| HOME_ASSISTANT_CONFIGURATION | URL, token, domains, state and WebSocket preflight           | real                | passed                          | Three configured resources reachable; report is redacted.                                |
| CLIMATE_PROVIDER             | HVAC mode and target temperature through Runtime and Adapter | real                | passed for executed lab climate | Original state restored; frozen tasks/result compatibility remains blocked.              |
| LIGHT_PROVIDER               | Power control for both configured lights                     | real                | passed for executed lab lights  | Each light changed and restored within 2-write budget.                                   |
| MCP_TASKS_RUNTIME            | Duplicate Task ID and argument conflict                      | real/contract       | passed                          | Same key converged; different arguments returned InvalidParams/IDEMPOTENCY_KEY_CONFLICT. |
| MCP_TASKS_RUNTIME            | tasks/result compatibility                                   | real                | blocked                         | Frozen profile returns 404 Method not found.                                             |
| MCP_TASKS_RUNTIME            | Runtime restart during real task                             | unverified          | unverified                      | Not induced after bounded real-device runs.                                              |
| ADAPTER_PROTOCOL             | Adapter gRPC manifest/resource/task path                     | contract/real       | passed for executed paths       | Protocol conformance reports 8/8; real runs used gRPC.                                   |
| PMS_CONFIGURATION            | Formal live package/provider/resource/config flow            | unverified          | blocked                         | No live PMS API/worker deployment in this run.                                           |
| CATALOG                      | Tool list and Resource Binding                               | contract            | passed                          | Both Home Assistant platform E2Es pass.                                                  |
| REGISTRY                     | Latest/bootstrap/watch and checksum/ETag                     | unverified          | blocked                         | No live target Registry publication claimed.                                             |
| HOME_ASSISTANT_CAPABILITY    | unavailable, REST 200 without state change                   | contract/unverified | unverified for real devices     | Fake/contract coverage exists; no artificial real fault injected.                        |
| MANUAL_SAFETY_BLOCK          | AC opposite power interval                                   | real                | passed                          | No opposite AC power write was forced; HA returned to original state.                    |

The matrix deliberately separates executed real evidence from contract and unverified evidence.
