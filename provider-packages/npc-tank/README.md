# Built-in NPC Tank Provider Package

`builtin.isr.vehicle.npc-tank@0.1.0` describes the delivered NPC Tank Provider
Adapter. It is version-locked repository metadata, not an online plugin or an
arbitrary command definition.

## Package bindings

| Field                        | Binding                                        |
| ---------------------------- | ---------------------------------------------- |
| Provider type                | `isr.vehicle.npc_tank`                         |
| Adapter source entry         | `apps/npc-tank-provider-adapter/src/main.ts`   |
| Configuration definition     | `provider.npcTank`                             |
| Current configuration source | `apps/npc-tank-provider-adapter/src/config.ts` |
| Provider Migration set       | `provider:npc-tank`                            |
| Compatible Runtime           | `2.0.0-rc.1`, frozen protocol mode             |

`vendor_managed` is the production default. `platform_managed` is limited to
the built-in reference implementation, controlled simulations, or an explicit
deployment choice.

The Adapter owns its `npc_tank_*` database tables and device/domain execution;
it does not share the UGV ledger. Runtime remains Task Authority and the MCP
data plane. Package metadata is only a pre-deployment preview. The formal
Operation Catalog comes from Runtime `server/discover` and `tools/list`.

## Conditional capabilities

The Provider advertises circular EO scan only when all three required Device
MCP tool contracts are valid. Navigation prefers
`npc_tank_path_follow_mission` and falls back to `npc_tank_send_waypoints` only
when the primary contract is absent or invalid. These rules are evidenced by:

- `reports/npc-tank-provider-v1/eo-scan-capability.json`;
- `reports/npc-tank-provider-v1/navigation-tool-selection.json`.

They describe conditional behavior and do not turn captured Mock MCP tools
into a real-device qualification claim.

## Qualification

Component status is `passed` against the supplied protocol and Mock Level 1
contract, backed by `reports/npc-tank-provider-v1/component.json` and
`docs/baseline/PROVIDER_QUALIFICATION_BASELINE.json`.

Real-resource status remains `pending`. Real NPC Tank Device MCP conformance,
real ISR MQTT schemas, and real-interface smoke were unavailable, as recorded
in `reports/npc-tank-provider-v1/external-interface-blocker.json`.

`apps/mock-npc-tank-device-mcp` and
`apps/mock-npc-tank-mqtt-publisher` remain test fixtures and are not production
Provider Packages.
