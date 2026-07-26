# Frozen Runtime Closure Failing Cases

Baseline: `c5594e4cb59f77421a8aa107defa6054ca61a768`

## Reproduction

Command:

```powershell
.\node_modules\.bin\vitest.cmd run tests/runtime-conformance-closure --reporter=dot
```

Result on the unmodified Runtime implementation: **7 test files failed, 19 tests failed**.

| IDs          | Observed baseline failure                                                                                                                                                                    |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-001, R-002 | `updateTaskInputResponses()` did not call the durable acceptance boundary before PAUSE or UPDATE command arbitration; the repository also had no independent pending-response promotion API. |
| R-003        | A different response for an ANSWERED key threw `INPUT_RESPONSE_CONFLICT` instead of being ignored.                                                                                           |
| R-004        | A SUPERSEDED response was not classified and ignored through a durable acceptance result.                                                                                                    |
| R-005        | The second client using the same string Request ID was rejected.                                                                                                                             |
| R-006        | Numeric `1` and string `"1"` collided.                                                                                                                                                       |
| R-007        | A second authorization scope using the same ID was rejected.                                                                                                                                 |
| R-008        | A second transport could not own an independent same-ID stream.                                                                                                                              |
| R-009        | Cancelling string `"1"` cancelled the numeric `1` subscription.                                                                                                                              |
| R-010, R-011 | Runtime-only notifications synthesized `eventId=task-a:1` and `observedAt` from Runtime state.                                                                                               |
| R-012        | Strict notification/tasks-get comparison differed on the synthetic Provider fields.                                                                                                          |
| R-013        | Adapter contract failure returned JSON-RPC `-32602`, HTTP 400.                                                                                                                               |
| R-014        | Adapter transient failure returned JSON-RPC `-32602`, HTTP 400 and omitted `retryable=true`.                                                                                                 |
| R-015        | Technical execution failure returned JSON-RPC `-32602`, HTTP 400.                                                                                                                            |
| R-016        | A configured global subscription limit was ignored.                                                                                                                                          |
| R-017        | A configured global Task-binding limit was ignored.                                                                                                                                          |
| R-018        | A 256-Task subscription performed individual reads and never called either batch repository boundary.                                                                                        |

Additional capacity evidence: `response.write() === false` immediately ended the stream instead of waiting for `drain` within an application queue bound.
