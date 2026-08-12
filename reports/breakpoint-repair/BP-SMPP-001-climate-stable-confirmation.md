# BP-SMPP-001 Climate Stable Confirmation

Status: `FIXED`

## Breakpoint

The previous real integration run observed this sequence:

```text
off -> cool -> Provider success -> about three seconds -> off
```

The locked main implementation treated the first matching Climate observation as terminal proof.
That is insufficient for a physical-device Task because the observation may be transient or may
regress immediately after it is received.

## Repair semantics

The repair uses this internal progression:

```text
PENDING_SIDE_EFFECT
  -> CALL_RETURNED
  -> CONFIRMING
  -> candidate match
  -> uninterrupted stability window
  -> SUCCEEDED
```

The Adapter protocol is not expanded with a public candidate state. Candidate confirmation remains
Provider-owned durable state.

The centralized policy is represented by:

```ts
interface ClimateConfirmationPolicy {
  confirmationTimeoutMs: number;
  minimumStableDurationMs: number;
  minimumMatchingObservations: number;
}
```

Production defaults are a 15-second confirmation timeout, a 5-second minimum stable duration, and
three matching observations. Configuration parsing validates numeric bounds and rejects a stable
duration that is not shorter than the confirmation timeout. Deterministic tests inject a fake clock;
correctness does not depend on a real `sleep(4000)`.

## Persisted confirmation state

The repair persists these fields with the execution record:

- `confirmationBaselineObservedAt`
- `candidateConfirmedAt`
- `matchingObservationCount`
- `lastMatchingObservationAt`
- `lastObservedState`
- `confirmationDeadlineAt`

Store validation checks timestamp shape, candidate/count consistency, task-key identity, and the
relationship between `dispatchState` and `sideEffectDispatched`. Restart therefore does not erase a
candidate window or turn a completed dispatch back into a new Home Assistant call.

## Observation rules

- An unreachable state or a state that does not match the desired value resets the candidate start,
  last-match timestamp, and matching count.
- A fresh match starts a new candidate window; subsequent observations increase the count without
  moving the original candidate start.
- Success requires both the configured observation count and stable duration.
- The confirmation deadline is checked before accepting success. Expiration produces
  `TECHNICAL_FAILED` with `HOME_ASSISTANT_STATE_CONFIRMATION_TIMEOUT`.
- Recovery of `CONFIRMING` continues from the persisted candidate state and does not dispatch the
  physical side effect again.

## Regression matrix

The deterministic suite `tests/integration/home-assistant-climate-stability.test.ts` contains the
following cases. They passed on exact candidate
`23eb2ed1c14830a8a6b328d3a67df1badcd492ab`.

| Scenario              | Required outcome                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| S1 transient match    | `off -> cool -> off` never becomes `SUCCEEDED`.                                                                      |
| S2 stable success     | Repeated `cool` observations across the full window become `SUCCEEDED`.                                              |
| S3 interrupted window | A mismatch discards the first window; the next match starts from zero.                                               |
| S4 single observation | One match remains non-terminal when multiple observations are required.                                              |
| S5 timeout            | An unstable/unconfirmed state becomes `TECHNICAL_FAILED` at the deadline.                                            |
| S6 restart in window  | Recovery retains the candidate, makes no duplicate HA call, and reaches the correct final state.                     |
| Historical regression | A match followed by `off` after three seconds remains non-terminal; a later uninterrupted `cool` window can succeed. |

## Compatibility and safety

- No new Home Assistant domains, operations, fan modes, swing modes, presets, or humidity controls
  are introduced.
- Terminal result and evidence continue to derive from an actual normalized Home Assistant
  observation.
- The native Registry and `sdar-registry-v1` projection are unchanged.
- Tests use deterministic fake Home Assistant clients. Physical-device write authority remains
  closed.

## Final qualification

The focused Climate selection passed 7 files / 40 tests; `test:ha-climate` passed 5 files / 33
tests; the Climate Runtime E2E passed 1/1; `test:fault-injection` passed 5 files / 39 tests; and the
formal `verify:platform` and `verify:v2` gates passed on the exact candidate. The historical
transient-match regression is permanently included in the deterministic suite. No real-device
write gate was enabled and no physical device write occurred during this qualification.
