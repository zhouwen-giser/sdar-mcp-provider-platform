# Climate real qualification

- Evidence class: `real`
- Status: **BLOCKED**
- Provider: `ha-climate-lab`
- Protocol: `frozen_v1`
- Safety gate: `{"allowRealDeviceSideEffects":true,"runIdPresent":true,"writeBudget":{"climatePowerOn":1,"climatePowerOff":1,"climateHvacMode":2,"climateTemperature":2},"writesUsed":{"climatePowerOn":1,"climatePowerOff":0,"climateHvacMode":1,"climateTemperature":2}}`

## Scenarios

- `climate_set_hvac_mode`: completed (Task 4dbbe3c1-d095-4f6b-abf7-09cd9cdda017)
- `climate_set_temperature`: completed (Task 204cedcc-ac5f-4ecb-b2f7-01c46fca722e)
- `climate_set_temperature`: completed (Task 0fef26d5-8586-4d1a-89af-86f0f6bb8ec7)

## Restoration

- {"status":"restored","original":{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","currentTemperature":null,"targetTemperature":23,"observedAt":"2026-08-02T14:46:04.623464+00:00","observationId":"cdd66c015428984da1b28bddc37226df52e7432c1423e4bb3028d1a7b16350b1"},"currentBeforeRestore":{"resourceId":"living-room-air-conditioner","power":"on","reachable":true,"hvacMode":"cool","currentTemperature":null,"targetTemperature":24,"observedAt":"2026-08-02T15:21:42.610122+00:00","observationId":"d719b8b96caf13a75257df482f68a181ba68bfd9cbcd75cba34bfcaf7d8802a4"},"manualRestoreRequired":false,"waits":[],"currentAfterRestore":{"resourceId":"living-room-air-conditioner","power":"off","reachable":true,"hvacMode":"off","currentTemperature":null,"targetTemperature":23,"observedAt":"2026-08-02T15:21:44.973183+00:00","observationId":"f47a0e78df14341578ac15c28f144d707464a06095b5f0e130c53c5a2a8e91f4"}}

## Blockers

- `FROZEN_MCP_TASKS_RESULT_UNSUPPORTED`

All entity identifiers and tokens are excluded; configured entity references are represented only by SHA-256 hashes in JSON evidence.
