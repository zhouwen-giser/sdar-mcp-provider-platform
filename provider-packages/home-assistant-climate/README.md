# Built-in Home Assistant Climate Provider Package

`builtin.home-assistant.climate@0.1.0` describes the delivered non-vehicle Home
Assistant Climate Provider. It is version-locked repository metadata rather
than an online plugin.

## Package bindings

| Field                        | Binding                                                             |
| ---------------------------- | ------------------------------------------------------------------- |
| Provider type                | `home_assistant.climate`                                            |
| Adapter source entry         | `apps/home-assistant-climate-provider/src/main.ts`                  |
| Configuration definition     | `provider.climate`                                                  |
| Current configuration source | `apps/home-assistant-climate-provider/src/config.ts`                |
| Resource-file example        | `apps/home-assistant-climate-provider/config/climates.example.json` |
| Provider Migration set       | `null`                                                              |
| Compatible Runtime           | `2.0.0-rc.1`, frozen protocol mode                                  |

This package declares only `vendor_managed`, which is the production default.
The Provider uses its own JSON state store and has no delivered Provider
database migration, so `adapter.migrationSet` is explicitly `null`; it must not
borrow a Runtime or vehicle Provider Migration set.

Home Assistant tokens are loaded from `HOME_ASSISTANT_TOKEN_FILE`. The package
contains no secret values. Resource configuration is allowlisted through
`CLIMATE_RESOURCES_FILE`.

Runtime remains Task Authority and the MCP data plane. The package description
does not establish an Operation Catalog; formal operations are discovered from
the running Runtime with `server/discover` and `tools/list`.

## Qualification

`reports/home-assistant-climate/provider-conformance.json` records 8/8 Provider
component cases and explicitly sets `realResourceQualified` to `false`. This
maps to:

- `componentStatus: passed`;
- `realResourceStatus: pending`.

The work used the repository Fake Home Assistant and a local PostgreSQL-backed
Runtime. No physical climate device or independently managed Home Assistant
deployment was qualified. The boundary is documented in
`reports/home-assistant-climate/final-delivery-report.md` and
`docs/baseline/PROVIDER_QUALIFICATION_BASELINE.json`.

`tests/fixtures/fake-home-assistant-climate.ts` remains a test fixture and is
not a production Provider Package.
