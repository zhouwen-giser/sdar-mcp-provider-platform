# Home Assistant Climate Provider

The Node.js Home Assistant Climate Provider maps configured Home Assistant `climate.*` entities
to the Runtime Adapter protocol:

```text
MCP client -> SDAR Runtime -> Adapter gRPC -> HA REST/WebSocket -> climate entity
```

## Setup

Configure the air conditioner in Home Assistant and confirm it appears under Developer Tools as a
`climate.*` entity. Create a Long-Lived Access Token from the Home Assistant user profile and
write it to a process-readable secret file. The Provider rejects token environment variables.

Copy `apps/home-assistant-climate-provider/config/climates.example.json`. `resourceId` is public;
`entityId` stays Provider-internal. `temperatureRange` and `allowedHvacModes` are local safety
limits. Home Assistant's current `min_temp`, `max_temp`, and `hvac_modes` are also enforced.

Set `HOME_ASSISTANT_URL`, `HOME_ASSISTANT_TOKEN_FILE`, `CLIMATE_RESOURCES_FILE`, and
`PROVIDER_STATE_PATH`, then run `pnpm dev:ha-climate`. Runtime uses:

```text
PROVIDER_ID=home-assistant-climate
ADAPTER_ENDPOINT=127.0.0.1:7020
PROVIDER_TELEMETRY_INGRESS_ENABLED=true
```

Production plaintext HTTP is rejected unless `HOME_ASSISTANT_ALLOW_INSECURE_HTTP=true` is set.
Adapter and Provider Telemetry support required mutual TLS using CA, certificate, and key paths.

## Operations

- `climate_get_state`: power, reachability, HVAC mode, current/target temperature, and unit.
- `climate_set_power`: calls `climate.turn_on` or `climate.turn_off` and confirms observed state.
- `climate_set_hvac_mode`: calls `climate.set_hvac_mode` after allowlist/capability validation.
- `climate_set_temperature`: calls `climate.set_temperature` after range validation.

HTTP success is not completion proof. The Provider completes Tasks only after WebSocket
`state_changed` or REST polling confirms the desired state. Task identity and pending telemetry
are atomically persisted for restart recovery. Duplicate `taskId` does not repeat a side effect.

Resource state, current/target temperature metrics, resource health, and Task progress are sent
through Runtime `ProviderTelemetryIngress`. Delivery failure does not change control outcomes.

## Frozen MCP Tasks V1

All Runtime calls use MCP Stateless `2026-07-28` Request Meta and routing headers. State reads are
`synchronous_only`; power, HVAC-mode, and target-temperature controls are `task_required` and
return flat Task results. Provider E2E proves Ack-first subscriptions, working and completed
notifications, and equality with `tasks/get` at the same Runtime Revision.

Completion persists the actual Home Assistant observation and derives both structured output and
type-only Evidence from that fact. Evidence points to `/power`, `/hvacMode`, or
`/targetTemperature` as applicable and never contains `requirementId`.

## Docker

Copy the example deployment config, create the token secret, and run:

```bash
docker compose -f compose.yaml -f deploy/home-assistant-climate/compose.override.yaml up --build
```

The image runs as non-root. Fan speed, swing, humidity, presets, discovery, direct vendor
protocols, pause/resume, and cancellation after dispatch are not supported in the first version.
