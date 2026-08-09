# Home Assistant real-device setup

This repository keeps real Home Assistant inputs under ignored `.local/ha-real-device/`:

- `token.txt` contains only the Long-Lived Access Token.
- `resources.local.json` contains the URL and the explicitly allowlisted climate and light resources.
- `original-state.json` and `run-state.json` are local recovery records.

Run `pnpm ha:real:preflight` first. It is read-only and verifies REST, WebSocket authentication, state subscriptions, entity domains, reachability, climate capabilities, and light brightness capability. The preflight report is redacted and never contains the token or raw Authorization header.

Real writes are not enabled by default. A controlled run must provide both `ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES` and a unique `REAL_DEVICE_TEST_RUN_ID`; the driver enforces a durable per-run write budget and records the original state before any write. A climate operation that can change power—including `climate_set_power` and `climate_set_hvac_mode` while the entity is off—also requires `ALLOW_CLIMATE_POWER_TEST=YES` and must fail closed while the five-minute opposite-power interval is active.
