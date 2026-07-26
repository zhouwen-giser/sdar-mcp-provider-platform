# Existing configuration inventory

`CONFIG_INVENTORY.json` is the machine-readable source inventory for the
delivered Runtime and Provider configuration schemas. It was extracted from
the existing Zod object properties; it does not introduce defaults or future
configuration behavior.

## Coverage

| Component                       | Source                                               |  Fields |
| ------------------------------- | ---------------------------------------------------- | ------: |
| Runtime                         | `apps/runtime/src/config.ts`                         |      98 |
| UGV Provider                    | `apps/ugv-provider-adapter/src/config.ts`            |      50 |
| NPC Tank Provider               | `apps/npc-tank-provider-adapter/src/config.ts`       |      52 |
| Home Assistant Climate Provider | `apps/home-assistant-climate-provider/src/config.ts` |      26 |
| **Total**                       | four current Zod schemas                             | **226** |

An independent AST key-set comparison verifies 226 expected, 226 inventoried,
and 226 unique component/key pairs. Each JSON item records the source line,
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

- Runtime production forbids development auth and weak lease configuration,
  requires Adapter mTLS, requires mTLS for enabled Provider telemetry ingress,
  requires HTTPS for enabled OTLP and configured Outbox webhook, and enforces
  lease-duration safety equations.
- UGV and NPC Tank production require Adapter mTLS, MQTT TLS, an explicit MQTT
  wire mode, and PostgreSQL storage. Required TLS modes require CA,
  certificate, and key paths.
- Home Assistant forbids token environment values, requires
  `HOME_ASSISTANT_TOKEN_FILE`, restricts the URL protocol, guards production
  plaintext HTTP, validates required mTLS files, and rejects an empty token
  file.

These are source facts, not relaxed or rewritten rules.

## Verification

Run the task-package gate:

```bash
python3 .codex/task-package/scripts/verify_config_inventory.py
```

The gate validates the required item shape. Completion evidence also includes
the independent AST comparison of all four source schemas, because the
task-package verifier alone does not prove that no current environment field
was omitted.
