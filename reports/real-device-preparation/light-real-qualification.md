# Light real qualification

- Evidence class: `real`
- Status: **PASSED**
- Provider: `ha-light-lab`
- Protocol: `frozen_v1`
- Safety gate: `{"allowRealDeviceSideEffects":true,"runIdPresent":true,"perResourceWriteBudget":2,"writesUsed":{"living-room-main-light":2,"living-room-aux-light":2}}`

## Scenarios

- `light_set_power` / unknown: completed (Task ef41e7e4-adee-4c0c-81ba-3212471ceca3)
- `light_set_power` / unknown: completed (Task 9eb85faa-8e84-4550-827c-29065df772aa)
- `light_set_power` / unknown: completed (Task 4fa30353-fbf6-4209-8c62-0326d3a32840)
- `light_set_power` / unknown: completed (Task ce2a4f97-5fa0-4489-8e5b-c00a60ab222f)

## Restoration

- {"resourceId":"living-room-main-light","status":"restored","original":{"resourceId":"living-room-main-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-03T16:09:39.776901+00:00","observationId":"b36ff0f49804d26adde9a997dc9a9d96c11a74d04ba589f5d9675f597256e1f6"},"currentBeforeRestore":{"resourceId":"living-room-main-light","power":"on","reachable":true,"brightnessPercent":100,"observedAt":"2026-08-03T19:13:14.142853+00:00","observationId":"397f078c5672926d4d9c1794b2e716a7423c5ef82fefa075ea931b4602834e31"},"manualRestoreRequired":false,"currentAfterRestore":{"resourceId":"living-room-main-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-03T19:13:15.232500+00:00","observationId":"578486be5c5896e18c4532602c058e76a46a0c14f482b00b2ef8ad621e9f57a7"}}
- {"resourceId":"living-room-aux-light","status":"restored","original":{"resourceId":"living-room-aux-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-03T16:11:32.857128+00:00","observationId":"3d53b0b14d4f8710178a3f9cf4655ca68663ee8c270ee19837ccf16e3cc1d82b"},"currentBeforeRestore":{"resourceId":"living-room-aux-light","power":"on","reachable":true,"brightnessPercent":100,"observedAt":"2026-08-03T19:13:16.235163+00:00","observationId":"9e42b795f0d01077b7abcdc25439db713a2756b032a3beb75303cb4b5ffc94d4"},"manualRestoreRequired":false,"currentAfterRestore":{"resourceId":"living-room-aux-light","power":"off","reachable":true,"brightnessPercent":null,"observedAt":"2026-08-03T19:13:16.954162+00:00","observationId":"47c5cb577142150da63b38e957ba016a5b83367658ec134e105224d9849ac1b0"}}

## Blockers

- None recorded.

Light side effects were limited to the two configured resources. Entity identifiers and tokens are excluded from this report; entity references are represented only by SHA-256 hashes.
