# Existing configuration inventory

`CONFIG_INVENTORY.json` is the machine-readable source inventory for the
delivered Runtime and Provider configuration schemas. It was extracted from
the existing Zod object properties; it does not introduce defaults or future
configuration behavior.

## Coverage

| Component                       | Source                                               |  Fields |
| ------------------------------- | ---------------------------------------------------- | ------: |
| Runtime                         | `apps/runtime/src/config.ts`                         |      99 |
| UGV Provider                    | `apps/ugv-provider-adapter/src/config.ts`            |      65 |
| NPC Tank Provider               | `apps/npc-tank-provider-adapter/src/config.ts`       |      53 |
| Home Assistant Climate Provider | `apps/home-assistant-climate-provider/src/config.ts` |      28 |
| **Total**                       | four current Zod schemas                             | **245** |

An independent AST key-set comparison verifies 245 expected, 245 inventoried,
and 245 unique component/key pairs. Each JSON item records the source line,
bootstrap/runtime/provider group, subgroup, exact validator expression, default
presence and value, required status, Secret classification, and Apply Mode.

There is no delivered Collector configuration source. The `collector` group is
therefore explicitly empty rather than populated with speculative fields.

## Defaults and compatibility

`defaultDefined=false` means the current Zod field has no default. Its
`defaultValue=null` is an inventory placeholder, not a new null default.
Literal string, number, and boolean defaults are otherwise preserved exactly.

The three source connection-string defaults are Secret-bearing legacy
literals. Their values and validator expressions are not copied into this
report. Each is represented by `[REDACTED_SOURCE_LITERAL]` plus a SHA-256
fingerprint so later extraction can detect a silent default change without
writing the literal to evidence.

No existing parser, default, validation rule, or production default is changed
by this task.

## Secret inventory

The inventory identifies 22 Secret-bearing fields. `secret_file_reference`
means only a file path is configured; it is not the Secret value.

| Component              | Legacy direct Secret or connection string                  | Secret file references                                                                                                                                     |
| ---------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime                | `DATABASE_URL`, `JWT_HS256_SECRET`, `INTERNAL_ADMIN_TOKEN` | `OTEL_EXPORTER_OTLP_KEY_PATH`, `OTEL_EXPORTER_OTLP_HEADERS_FILE`, `PROVIDER_TELEMETRY_TLS_KEY_PATH`, `ADAPTER_TLS_KEY_PATH`                                |
| UGV                    | `UGV_ADAPTER_DATABASE_URL`                                 | `ADAPTER_TLS_KEY_PATH`, `UGV_MQTT_PASSWORD_FILE`, `UGV_MQTT_TLS_KEY_PATH`, `UGV_DEVICE_MCP_HEADERS_FILE`, `PROVIDER_TELEMETRY_TLS_KEY_PATH`                |
| NPC Tank               | `NPC_TANK_ADAPTER_DATABASE_URL`                            | `ADAPTER_TLS_KEY_PATH`, `NPC_TANK_MQTT_PASSWORD_FILE`, `NPC_TANK_MQTT_TLS_KEY_PATH`, `NPC_TANK_DEVICE_MCP_HEADERS_FILE`, `PROVIDER_TELEMETRY_TLS_KEY_PATH` |
| Home Assistant Climate | none                                                       | `ADAPTER_TLS_KEY_PATH`, `HOME_ASSISTANT_TOKEN_FILE`, `PROVIDER_TELEMETRY_TLS_KEY_PATH`                                                                     |

The legacy direct fields are migration inputs for the shared configuration
contract; they are not approval to place Secret values in PMS data, PM2
Ecosystem data, logs, reports, or Git.

## Apply Mode baseline

Current applications parse these schemas at process startup and do not share a
hot-reload contract. Consequently:

- `PROVIDER_ID` and Provider `PROVIDER_VERSION` fields are marked `immutable`
  from the architecture identity boundary;
- every other field is conservatively `restart_required` with
  `applyModeStatus=pending_review`.

Later P3 cards may promote a field to `hot_reload` or `reconnect_required` only
when the shared contract and runtime behavior implement and test that mode.
This baseline does not claim hot application merely because a field might be a
good future candidate.

## Production constraints retained

The JSON inventory records the source rule set for each component. Important
existing constraints include:

- Runtime production forbids development auth and weak lease configuration and
  enforces lease-duration safety equations. The explicit `anonymous` auth mode is
  accepted in production only together with
  `ALLOW_INSECURE_INTERNAL_TRANSPORT=true`; all callers then share one fixed
  authorization domain. Adapter/telemetry mTLS and
  OTLP/Outbox HTTPS remain fail-closed unless the operator explicitly sets
  `ALLOW_INSECURE_INTERNAL_TRANSPORT=true` for an isolated internal network.
- UGV and NPC Tank production require an explicit MQTT wire mode and PostgreSQL
  storage. Adapter mTLS and MQTT TLS remain fail-closed unless the same explicit
  internal-transport opt-in is set. Required TLS modes still require CA,
  certificate, and key paths.
- PMS Worker external Runtime Catalog authentication defaults to
  `PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=file_credentials`. The independent
  `anonymous_intranet` mode requires `ALLOW_INSECURE_INTERNAL_TRANSPORT=true`;
  the transport opt-in alone never disables Catalog credentials.
- Home Assistant forbids token environment values, requires
  `HOME_ASSISTANT_TOKEN_FILE`, restricts the URL protocol, guards production
  plaintext HTTP, validates required mTLS files, and rejects an empty token
  file.

The internal-network exception changes transport requirements and, only when
`AUTH_MODE=anonymous` is selected independently, permits shared anonymous Runtime
access. Secret handling for databases and control-plane registration,
persistence, and the remaining production safety constraints stay active.

## Verification

Run the task-package gate:

```bash
python3 .codex/task-package/scripts/verify_config_inventory.py
```

The gate validates the required item shape. Completion evidence also includes
the independent AST comparison of all four source schemas, because the
task-package verifier alone does not prove that no current environment field
was omitted.
