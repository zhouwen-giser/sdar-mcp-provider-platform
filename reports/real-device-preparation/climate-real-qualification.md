# Climate real qualification

- Evidence class: `real`
- Status: **PASSED**
- Provider: `ha-climate-lab`
- Protocol: `frozen_v1`
- Safety gate: `{"allowRealDeviceSideEffects":true,"runIdPresent":true,"writeBudget":{"climatePowerOn":1,"climatePowerOff":1,"climateHvacMode":2,"climateTemperature":2},"writesUsed":{"climatePowerOn":1,"climatePowerOff":0,"climateHvacMode":1,"climateTemperature":2}}`

## Scenarios

- `climate_set_hvac_mode`: completed (Task 5a0d4806-92e9-4c70-a84a-c6d61644a00e)
- `climate_set_temperature`: completed (Task fa911d70-137b-4e1e-bde6-9c0b932581e6)
- `climate_set_temperature`: completed (Task cce0de4d-ff58-4323-9225-5f1de1a33b0e)

## Restoration

- {"status":"restored","original":{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","currentTemperature":null,"targetTemperature":23,"observedAt":"2026-08-03T16:40:52.277934+00:00","observationId":"ea07c4efd79413dfd6161e84d57255129dcd755a2b096f5ad67b703b383e16c1"},"currentBeforeRestore":{"resourceId":"living-room-air-conditioner","power":"on","reachable":true,"hvacMode":"cool","currentTemperature":null,"targetTemperature":24,"observedAt":"2026-08-03T19:12:27.187232+00:00","observationId":"d77d6b7e9f0c39db9046c2d323012a534397fdfecc249cf444b4b1d0a47455df"},"manualRestoreRequired":false,"waits":[],"currentAfterRestore":{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","currentTemperature":null,"targetTemperature":23,"observedAt":"2026-08-03T19:12:29.884771+00:00","observationId":"5cde9803bc936fabc66f5d3db219dbfa5a8b4449a1570a280a262bb28a027975"}}

## Blockers

- None recorded.

All entity identifiers and tokens are excluded; configured entity references are represented only by SHA-256 hashes in JSON evidence.
