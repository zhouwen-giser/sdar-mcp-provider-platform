# Climate restore recovery

- Evidence class: `real`
- Status: `passed`
- Integration run: `019fca75-f48a-7780-ac5e-942503c6690e-g09-g11-c7e36bbf-4620-4f44-800a-83c15ec4095b`
- Device restore: `restored`
- Source state: `{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","targetTemperature":16,"currentTemperature":null,"observedAt":"2026-08-11T15:33:54.603540+00:00","observationId":null}`
- Current before restore: `{"resourceId":"living-room-air-conditioner","power":"on","reachable":true,"hvacMode":"cool","targetTemperature":16,"currentTemperature":null,"observedAt":"2026-08-11T21:45:28.435682+00:00","observationId":null}`
- Wait: `{"safetyIntervalMs":300000,"remainingMs":0,"waitedMs":0,"reason":"opposite climate power operation"}`
- Final state: `{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","targetTemperature":16,"currentTemperature":null,"observedAt":"2026-08-11T21:51:46.286602+00:00","observationId":null}`
- Runtime task counts: `not_queried`

Only the safety-gated `climate_set_power(off)` restore path is permitted by this recovery driver; no other device operation is attempted.

No `tasks/result` endpoint was called because it is not part of the repository's frozen MCP protocol surface.

## Errors

- none
