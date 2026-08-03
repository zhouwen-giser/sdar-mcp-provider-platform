# Climate restore recovery

- Evidence class: `real`
- Status: `passed`
- Integration run: `smpp-live-climate-restore-20260804-0329`
- Wait: `{"safetyIntervalMs":300000,"waitedMs":0,"reason":"opposite climate power operation"}`
- Final state: `{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","targetTemperature":23,"currentTemperature":null,"observedAt":"2026-08-03T19:30:50.792588+00:00","observationId":null}`

Only the safety-gated `climate_set_power(off)` restore path is permitted by this recovery driver; no other device operation is attempted.

No `tasks/result` endpoint was called because it is not part of the repository's frozen MCP protocol surface.

## Errors

- none
