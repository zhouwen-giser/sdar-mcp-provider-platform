# C1 protocol runner correction

- Evidence class: `static` plus `contract`; no Home Assistant write was performed by this correction.
- Frozen MCP authority: terminal task state is read from `tasks/get` and may also converge through Task notifications. The frozen protocol source, lock, and negative conformance test were not modified.
- Climate and Light real runners no longer call the removed legacy task-result method. Each runner records the terminal projection already returned by its `tasks/get` polling loop.
- The three-device aggregator now requires terminal projection evidence from the component report and no longer treats a removed-method response as a device failure.
- Current API documentation and recovery instructions now name `tasks/get` as the authoritative terminal read. Compatibility documentation keeps the removed method only as an explicit legacy/unsupported distinction.

## Verification

The focused regression suite passed:

```text
vitest run tests/unit/real-device-runner-protocol.test.ts
Test Files 1 passed
Tests 2 passed
```

The old reports under `reports/real-device-preparation/` remain historical evidence from the earlier candidate and are not rewritten to conceal that earlier mismatch. New continuation reports and the final handoff must use the corrected runner semantics.

Result: `REAL_RUNNER_EXPECTS_REMOVED_TASKS_RESULT=CLOSED`.
