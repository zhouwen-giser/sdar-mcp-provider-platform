# Phase P3 — Shared Configuration Contract

Status: PASSED

## Delivered scope

- Configuration inventory: 226 source-backed fields across Runtime, UGV, NPC Tank, and Home
  Assistant Climate.
- Six versioned `ConfigurationDefinition` groups covering all inventoried fields, plus the new
  Runtime `DATABASE_URL_FILE` compatibility field.
- Shared Zod parsing for Runtime bootstrap, observability, workers/events, and all three Provider
  configurations.
- Deterministic generation of 18 committed artifacts: JSON Schema, defaults, and UI metadata for
  each definition.
- Secret fields are marked `writeOnly` and `x-sdar-secretRef`; generated defaults omit Secret
  values.

## Compatibility matrix

| Configuration class | Defaults proof | Invalid fixture proof | Provider/API compatibility |
| --- | --- | --- | --- |
| Runtime | Every inventory default compared; legacy database default compared by SHA-256 | Port, boolean, Adapter mTLS, and production auth failures retained | `loadRuntimeConfig` retained |
| UGV | Every inventory default compared; database default compared by SHA-256 | Bounds, MQTT mTLS, and production rules retained | `loadUgvProviderConfig` retained |
| NPC Tank | Every inventory default compared; database default compared by SHA-256 | Boolean, mTLS, and production capability rules retained | `loadNpcTankProviderConfig` retained |
| Home Assistant Climate | Every optional inventory default plus required env fixture compared | Direct token env, insecure production HTTP, token file, URL, and TLS rules retained | `loadClimateConfig` retained |

## Explicit compatibility addition

`DATABASE_URL` remains accepted. `DATABASE_URL_FILE` is additionally accepted and has precedence
when both are present. The file is trimmed, must be non-empty and a valid URL, and failures expose
stable codes without the Secret value. This is the only intentional environment compatibility
extension in P3.

## Verification

- `pnpm test:config-compat`: 8 compatibility tests and 36 shared-contract tests passed.
- `pnpm config:schema:generate`: 18 artifacts generated; repeated generation is deterministic.
- `pnpm config:schema:check`: `CONFIGURATION_SCHEMA_CHECK_OK`.
- `pnpm build`, `pnpm typecheck`, and `pnpm lint`: passed.
- Generated-schema scan found no connection-string or token literal.

No default value change was detected. No PMS dependency was added to Runtime or any Provider
Adapter.
