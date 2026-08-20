# Follow-ups

## Local mock physical movement

The local Mock MQTT publisher emits a fixed position and does not follow point-navigation targets. This is independent of the Cursor JSONB fix and was deliberately not changed.

## LIVE retest

No real control was executed in this Goal. A later controlled retest must use a new idempotency key and follow `LIVE_RETEST_RUNBOOK.md`.
