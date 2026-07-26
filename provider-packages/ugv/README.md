# Built-in UGV Provider Package

`builtin.isr.vehicle.ugv@1.0.0` describes the delivered UGV Provider Adapter.
It is a version-locked repository package, not downloadable or arbitrary
executable plugin metadata.

## Package bindings

| Field                        | Binding                                   |
| ---------------------------- | ----------------------------------------- |
| Provider type                | `isr.vehicle.ugv`                         |
| Adapter source entry         | `apps/ugv-provider-adapter/src/main.ts`   |
| Configuration definition     | `provider.ugv`                            |
| Current configuration source | `apps/ugv-provider-adapter/src/config.ts` |
| Provider Migration set       | `provider:ugv`                            |
| Compatible Runtime           | `2.0.0-rc.1`, frozen protocol mode        |

`vendor_managed` is the production default. `platform_managed` is available
only for the built-in reference implementation, controlled demonstrations, or
an explicit deployment choice. The package does not authorize arbitrary
commands, working directories, or environment variables.

The UGV Adapter owns `ugv_*` persistence and device/domain execution. Runtime
remains Task Authority and the MCP data plane. The package description is an
onboarding preview; the formal Operation Catalog must be obtained from the
running Runtime through `server/discover` and `tools/list`.

## Qualification

Component status is `passed` only against the supplied protocol and Mock Level
1 contract. The evidence is:

- `docs/baseline/PROVIDER_QUALIFICATION_BASELINE.json`;
- `reports/ugv-provider-v1/component.json`.

Real-resource status remains `pending`. A real UGV Device MCP contract, real
ISR MQTT schema, and real-interface smoke verification were unavailable, as
recorded in `reports/ugv-provider-v1/external-interface-blocker.json`.

`apps/mock-ugv-device-mcp` and `apps/mock-ugv-mqtt-publisher` are test fixtures.
They are not production package entries and do not establish real-resource
qualification.
