# BP-SMPP-004 Fault Injection and Recovery Qualification Foundation

Status: `PARTIALLY_FIXED`

## Existing foundation

Current main already exposes dependency-injected, test-only hooks in both Home Assistant execution
engines:

- `afterDispatchIntentPersisted`
- `afterHomeAssistantCall`
- injectable `now` clock

These hooks are passed directly by tests and are not production environment switches. There is no
hidden `TEST_FAILPOINT_*` production toggle to accidentally enable. Production therefore fails
closed with respect to these fault points.

The Climate repair extends deterministic coverage around deadlines and restart during the stability
window. This is useful qualification infrastructure, but it is not the complete production fault
matrix.

## Recovery matrix

| Fault class                        | Current deterministic evidence                                                                        | Remaining qualification                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Provider restart                   | Persisted executions are recovered; Climate candidate state can continue after a constructed restart. | Final focused and integration rerun; real process restart remains outside this repair evidence. |
| Adapter restart                    | Local Adapter contract and persisted Provider state are testable independently.                       | No full process-level Adapter termination/reconnect qualification is claimed.                   |
| Notification loss                  | Polling uses the same Climate confirmation reducer as observations.                                   | Add/retain an explicit loss-to-poll fallback assertion in the final recovery run.               |
| HA unavailable before dispatch     | Read/call errors are handled as technical failure paths.                                              | Final matrix result must be recorded; no real outage is claimed.                                |
| HA unavailable after dispatch      | Durable intent prevents optimistic redispatch.                                                        | Explicit unavailable-after-call scenario remains part of final qualification.                   |
| HA unavailable during confirmation | Confirmation can remain pending until the deadline, then fail with the stable timeout code.           | Final unavailable sequence and pass result are pending.                                         |
| REST 200 but no target state       | HTTP success is not terminal proof; observation policy controls success.                              | Covered by the stable-confirmation suite; final candidate rerun pending.                        |
| Duplicate task                     | Store identity and dispatch markers prevent a second side effect for the same task.                   | Final `callServiceCount` evidence pending.                                                      |
| Duplicate command                  | Adapter command replay returns the same unsupported task-control Ack without an HA call.              | Broader Runtime command replay remains a repository verification concern.                       |
| Persisted state corruption         | Climate store validation checks task key, dispatch invariants, timestamps, and candidate state shape. | Final corruption-test result pending.                                                           |
| Poll fallback                      | Climate polling and WebSocket observation converge on one reducer.                                    | Worker/integration coverage must pass on the final candidate.                                   |
| Before Runtime Ack                 | No new production failpoint is introduced.                                                            | End-to-end Runtime Ack crash injection is not completed by this bounded Provider repair.        |

## Intended verification commands

Focused verification is expected to include the repository commands for Climate, Light, recovery,
fault injection, and Home Assistant integration, followed by static gates and the formal full
verification command. Exact outcomes belong in `test-results.json`; this draft makes no claim that
those gates are already green.

Database-backed commands require their documented PostgreSQL environment. Environment absence must
be reported as an external constraint rather than converted into a pass.

## Safety boundary

All fault tests default to deterministic fakes and `physicalDeviceWrites = 0`. This work does not set
`ALLOW_REAL_DEVICE_SIDE_EFFECTS`, `REAL_DEVICE_TEST_RUN_ID`, or `ALLOW_CLIMATE_POWER_TEST`.

## Deferred scope

The following remain beyond this bounded foundation and prevent promotion to `FIXED` in this draft:

- real process termination and reconnect at every crash point;
- real Home Assistant outage and network partition qualification;
- production-bundle failpoint rejection evidence if a future explicit failpoint mechanism is added;
- exhaustive cross-repository SDAR notification/ack failure injection.

Those gaps are documented rather than hidden, while BP-SMPP-001 through BP-SMPP-003 remain the core
delivery priority.
