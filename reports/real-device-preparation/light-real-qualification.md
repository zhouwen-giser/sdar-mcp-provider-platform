# Light real qualification

- Evidence class: `real`
- Status: **BLOCKED**
- Provider: `ha-light-lab`
- Protocol: `frozen_v1`
- Safety gate: `{"allowRealDeviceSideEffects":true,"runIdPresent":true,"perResourceWriteBudget":2,"writesUsed":{"living-room-main-light":2,"living-room-aux-light":2}}`

## Scenarios

- `light_set_power` / unknown: completed (Task d54a3c9f-64e3-4dda-b305-4a0363cb33a4)
- `light_set_power` / unknown: completed (Task f0515799-9a26-4595-9118-5de2e7d24dbb)
- `light_set_power` / unknown: completed (Task f11bb895-9f12-4ab4-9e46-4c867fbd4415)
- `light_set_power` / unknown: completed (Task b86ed682-4699-4d92-b945-39e1027a5fed)

## Restoration

- {"resourceId":"living-room-main-light","status":"restored","original":{"resourceId":"living-room-main-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-02T16:17:00.282152+00:00","observationId":"640e48fce29714d2071b8b0afbc91272119907802aeaf27d4e738847fed47baa"},"currentBeforeRestore":{"resourceId":"living-room-main-light","power":"on","reachable":true,"brightnessPercent":100,"observedAt":"2026-08-02T16:19:41.293016+00:00","observationId":"97490f88b5454d8cbbf8a72ad4f1969e903552b2bad1ef1a24ce2a6000a61db6"},"manualRestoreRequired":false,"currentAfterRestore":{"resourceId":"living-room-main-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-02T16:19:42.189475+00:00","observationId":"5b535fbba17f25faa6f2187be0023733755ebad3497ab03de49bf52078dc1d6c"}}
- {"resourceId":"living-room-aux-light","status":"restored","original":{"resourceId":"living-room-aux-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-02T16:17:02.426565+00:00","observationId":"e38a461996e6440862376fa18cdd9b2a117fa39a71733c2059cc875a823e8921"},"currentBeforeRestore":{"resourceId":"living-room-aux-light","power":"on","reachable":true,"brightnessPercent":100,"observedAt":"2026-08-02T16:19:43.446826+00:00","observationId":"1eeab6a6a95ccab31644aec16411387b21bd4463a281e4fc54a9a5be2d279fb0"},"manualRestoreRequired":false,"currentAfterRestore":{"resourceId":"living-room-aux-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-02T16:19:44.636121+00:00","observationId":"e4cb427c50e24f5492baa61adda9b3b7f05176409e484059e128ddbddc9a98fa"}}

## Blockers

- `FROZEN_MCP_TASKS_RESULT_UNSUPPORTED`

Light side effects were limited to the two configured resources. Entity identifiers and tokens are excluded from this report; entity references are represented only by SHA-256 hashes.
