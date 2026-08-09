# Failure semantics

Evidence classes remain separate; controlled tests do not replace real-device evidence.

| Scenario                                                        | Evidence class           | Status                                                            |
| --------------------------------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| PMS outage uses Runtime LKG                                     | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts           |
| Adapter process unavailable makes Runtime not ready             | real                     | observed in real-recovery.json                                    |
| Runtime crash backoff and recovery                              | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts           |
| Migration database unavailable fails closed and redacts details | controlledFaultInjection | passed by tests/fault-injection/platform-faults.test.ts           |
| Provider state-file corruption                                  | contract                 | covered by Home Assistant Provider security tests                 |
| REST 200 without target state change                            | unverified               | not injected                                                      |
| Real in-flight Adapter/Runtime restart                          | unverified               | not injected                                                      |
| Current three-device Home Assistant state                       | real                     | all three resources reachable and restored in the latest live run |

Source fault report status: `partial`.
