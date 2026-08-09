# Registry-backed SMPP MCP read-only E2E

- Evidence class: `real`
- Status: `blocked_resource_unavailable`
- Environment: `home-lab`
- Registry revision/checksum: `3 / dd7d0f9e7c447447aceaa134a684baa0a2650314f3f51f515930c70b325ea4d2`
- Registry providers: ha-climate-lab, ha-light-lab
- Runtime MCP reads: `3`
- Active/uncertain tasks: `0 / 0`

This report covers the PMS Registry-backed MCP read path only. No Home Assistant write operation was attempted.

## Runtime checks

- ha-climate-lab: 1 MCP state read(s); tools=climate_get_state, climate_set_power, climate_set_hvac_mode, climate_set_temperature
- ha-light-lab: 2 MCP state read(s); tools=light_get_state, light_set_power, light_set_brightness

## Errors

- HOME_ASSISTANT_RESOURCE_UNAVAILABLE
