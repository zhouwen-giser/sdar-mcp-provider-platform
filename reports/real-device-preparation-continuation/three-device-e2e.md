# Three-device SMPP MCP E2E

- Evidence class: `real`
- Status: `blocked_climate_safety`
- Integration run: `smpp-three-device-20260803-0910`
- Light restorations: restored, restored
- Runtime active/uncertain tasks: `0 / 0`

The read path is Registry-backed and uses the two PMS-managed Runtime `/mcp` endpoints. Light writes are guarded by the real-device gate and each write is confirmed through `tasks/get` plus a subsequent state read.

## Climate safety: `MANUAL_SAFETY_BLOCK`

Climate write skipped: changing HVAC mode may change power state and the inverse operation is protected by the five-minute safety interval.

No `tasks/result` endpoint was called because it is not part of the repository's frozen MCP protocol surface.

## Errors

- none
