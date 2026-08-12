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

## Captured capabilities

The real Device MCP inventory contains 15 tools. Navigation uses only the
captured `npc_tank_path_follow_mission`; the old `npc_tank_send_waypoints`
fallback is not part of the authoritative contract and is rejected. Circular
EO reconnaissance is advertised only when both captured configure/control
schemas expose their required fields. Runtime discovery remains the formal
public Operation Catalog.

## Qualification

Component status remains `passed`. Goal 11 adds a real read-only Device MCP
contract capture and passive MQTT evidence under
`reports/npc-tank-simulation/`; Mock fixtures are used only for deterministic
regression.

Real-resource status remains `pending` because the repository vocabulary has
no partial state and the complete core real qualification gates have not all
passed. The qualification report records the exact passed, partial, and
not-executed gates without upgrading this package field.

`apps/mock-npc-tank-device-mcp` and
`apps/mock-npc-tank-mqtt-publisher` remain test fixtures and are not production
Provider Packages.
