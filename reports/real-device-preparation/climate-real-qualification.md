# Climate real qualification

- Evidence class: `real`
- Status: `blocked_manual_safety`
- Provider: `ha-climate-lab`
- Resource: `living-room-air-conditioner`
- Read-only state: reachable, power `off`, HVAC mode `off`, target temperature `23`
- Observed tools: `climate_get_state`, `climate_set_power`, `climate_set_hvac_mode`, `climate_set_temperature`

No climate write was attempted in the current PMS Registry-backed run. The saved original power was `off`; changing HVAC mode could power the device on, while the five-minute inverse-power protection would prevent a safe bounded restoration. This is a manual safety block, not a pass.

See the current Registry-backed evidence in `reports/real-device-preparation-continuation/registry-backed-e2e.json`. Entity identifiers and credentials are excluded.
