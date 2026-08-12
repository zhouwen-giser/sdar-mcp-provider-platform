# BP-SMPP-002 Provider Crash, Restart, and Reconciliation

Status: `PARTIALLY_FIXED`

## Baseline result

The locked main already persists a durable dispatch marker:

```text
NOT_STARTED -> INTENT_PERSISTED -> CALL_RETURNED
```

It also has test-only hooks at `afterDispatchIntentPersisted` and `afterHomeAssistantCall`. Recovery
does not blindly repeat a Home Assistant call for a record whose intent is already durable. That
at-most-once foundation is `ALREADY_FIXED_ON_MAIN`.

Two deadline-ordering gaps remained reproducible on main:

1. An expired `NOT_STARTED` record could still dispatch a late physical write during recovery.
2. A matching observation could be accepted as success after `confirmationDeadlineAt`.

The working-tree repair checks the deadline before recovery dispatch, before a normal dispatch, and
before observation success. It also persists candidate confirmation state so recovery can continue
the same stability window.

## Crash-point semantics

| Crash point                                      | Recovery rule                                                                                                               | Side-effect rule                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| R1: intent durable before HA call                | Treat the durable intent as uncertain unless the system can prove the call did not occur; observe/reconcile or fail safely. | Do not automatically repeat `callService()`.                  |
| R2: HA returned before `CALL_RETURNED` persisted | Read actual device state and reconcile from the persisted `INTENT_PERSISTED` record.                                        | The existing task identity must not produce a second HA call. |
| R3: `CALL_RETURNED` / `CONFIRMING` before crash  | Continue polling and candidate confirmation from persisted state.                                                           | Never redispatch the original physical action.                |

For an expired record, the deadline wins before any of those recovery paths can produce a late
write or a late success.

## Deterministic evidence surface

The repair and existing tests use one execution engine and its existing hooks; they do not copy a
second recovery implementation. Relevant suites include:

- `tests/integration/home-assistant-climate-recovery.test.ts`
- `tests/integration/home-assistant-climate-stability.test.ts`
- `tests/integration/home-assistant-climate-provider.test.ts`
- `tests/integration/home-assistant-light-provider.test.ts`

The fake Home Assistant client records `callServiceCount`. Required assertions include:

- duplicate `taskId` does not repeat a side effect;
- restart after a post-call crash retains exactly one HA call;
- repeated recovery of an uncertain intent does not add calls;
- restart during confirmation resumes observation rather than dispatch;
- expired `NOT_STARTED` recovery fails with zero HA calls;
- corrupt persisted records fail closed instead of being interpreted optimistically.

Final pass counts and command results are intentionally reserved for `test-results.json`.

## State and telemetry consistency

The Provider record remains the authority for dispatch and candidate confirmation state. Polling and
WebSocket observations use the same confirmation reducer, so notification loss can fall back to
polling without changing success semantics. Pending telemetry remains durable and does not change
the physical control outcome if telemetry delivery fails.

## Boundaries

- `CANCELLED` does not mean a physical rollback occurred.
- Recovery never performs an automatic inverse Home Assistant operation.
- This report does not claim real process-kill, real network partition, or real-device fault
  qualification.
- No real-device side-effect environment gate is enabled.
- No SDAR-owned issue is repaired in this repository.

## Remaining qualification

Promotion to `FIXED` requires the final deterministic fault suite, Climate/Light integration suites,
database-backed recovery gates where available, full repository verification, and a clean final
candidate. Until those gates complete, BP-SMPP-002 remains `PARTIALLY_FIXED`.
