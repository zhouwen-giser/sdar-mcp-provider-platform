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

| Fault class                        | Current deterministic evidence                                                                                        | Remaining qualification                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Provider restart                   | Persisted executions are recovered; Climate candidate state continues after a constructed restart without redispatch. | Deterministic final-candidate tests passed; real process restart remains outside this repair evidence. |
| Adapter restart                    | Local Adapter contract and persisted Provider state are testable independently.                                       | No full process-level Adapter termination/reconnect qualification is claimed.                          |
| Notification loss                  | Polling uses the same Climate confirmation reducer as observations.                                                   | Deterministic polling paths passed; real transport-loss injection is not claimed.                      |
| HA unavailable before dispatch     | Read/call errors are handled as technical failure paths.                                                              | Final matrix result must be recorded; no real outage is claimed.                                       |
| HA unavailable after dispatch      | Durable intent prevents optimistic redispatch.                                                                        | Explicit unavailable-after-call scenario remains part of final qualification.                          |
| HA unavailable during confirmation | Confirmation can remain pending until the deadline, then fail with the stable timeout code.                           | Final unavailable sequence and pass result are pending.                                                |
| REST 200 but no target state       | HTTP success is not terminal proof; observation policy controls success.                                              | Covered by the stable-confirmation suite on the exact candidate.                                       |
| Duplicate task                     | Store identity and dispatch markers prevent a second side effect for the same task.                                   | Final `callServiceCount` assertions passed.                                                            |
| Duplicate command                  | Adapter command replay returns the same unsupported task-control Ack without an HA call.                              | Broader Runtime command replay remains a repository verification concern.                              |
| Persisted state corruption         | Climate store validation checks task key, dispatch invariants, timestamps, and candidate state shape.                 | Corruption tests passed on the exact candidate.                                                        |
| Poll fallback                      | Climate polling and WebSocket observation converge on one reducer.                                                    | Worker/integration coverage passed on the exact candidate.                                             |
| Before Runtime Ack                 | No new production failpoint is introduced.                                                                            | End-to-end Runtime Ack crash injection is not completed by this bounded Provider repair.               |

## Verification result

Exact candidate `23eb2ed1c14830a8a6b328d3a67df1badcd492ab` passed the focused Climate, recovery,
fault-injection, and Home Assistant provider-platform suites. It also passed `verify:platform` in
274.7 seconds and `verify:v2` in 1111.1 seconds using the documented disposable PostgreSQL test
environment. Exact counts and environment boundaries are recorded in `test-results.json`.

## Safety boundary

All fault tests default to deterministic fakes and `physicalDeviceWrites = 0`. This work does not set
`ALLOW_REAL_DEVICE_SIDE_EFFECTS`, `REAL_DEVICE_TEST_RUN_ID`, or `ALLOW_CLIMATE_POWER_TEST`.

## Deferred scope

The following remain beyond this bounded foundation and keep BP-SMPP-004 at `PARTIALLY_FIXED`:

- real process termination and reconnect at every crash point;
- real Home Assistant outage and network partition qualification;
- production-bundle failpoint rejection evidence if a future explicit failpoint mechanism is added;
- exhaustive cross-repository SDAR notification/ack failure injection.

Those gaps are documented rather than hidden, while BP-SMPP-001 through BP-SMPP-003 remain the core
delivery priority.
