# UGV Provider operations runbook

## Start the mock stack

Prerequisites are Node.js 22, pnpm 11 and Docker Compose. The profile starts two PostgreSQL
databases, Mosquitto, a mock Device MCP server, the UGV Adapter, one UGV Runtime and a mock publisher.

```bash
docker compose --profile ugv-provider up --build --wait
curl --fail http://127.0.0.1:19100/health/ready
curl --fail http://127.0.0.1:19100/metrics
```

The Adapter and Runtime use different database users and databases. Neither component should be
granted credentials for the other database.

## Production requirements

- Set `ADAPTER_TLS_MODE=required` and provide CA, certificate and key files.
- Set `UGV_MQTT_TLS_MODE=required`, a non-empty client ID, broker credentials through a password
  file, and an explicit wire mode (`ros_message_json` or `direct_domain_json`).
- Set the Device MCP URL to the UGV server only. Put fixed request headers in a mode-0600 JSON file;
  never use environment variables for bearer tokens.
- Disable `UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT`; live execution never falls back to fixture calls.
- Keep `UGV_DEVICE_MCP_ALLOW_CAPTURED_CONTRACT=false` unless an operator has reviewed the existing
  `mode=captured` report and intentionally needs catalog continuity during a southbound outage.
- Keep Provider telemetry ingress protected by mTLS and retain bounded label enumerations.

## Contract capture

At startup the Device MCP client performs MCP initialization and `tools/list`. The capture is written
to `reports/ugv-provider-v1/external-contract/ugv-device-mcp-tools.json` with server information,
protocol version, schemas and schema hashes. Only tools in both the capture and fixed allowlist are
callable. A missing or changed required schema causes availability `UNKNOWN`; it never triggers a
guessed request mapping.

When `UGV_DEVICE_MCP_ALLOW_CAPTURED_CONTRACT=true`, a failed live handshake may reuse only a prior
`mode=captured` report whose tool names, object schemas, timestamps and schema hashes all validate.
This preserves catalog discovery, not execution availability: every mutation still requires a
connected live MCP transport and otherwise fails before dispatch with `UGV_DEVICE_MCP_UNAVAILABLE`.
The client continues reconnecting and replaces the cached catalog only after a fresh live capture.

## Failure handling

| Symptom                             | Adapter behavior                              | Operator action                             |
| ----------------------------------- | --------------------------------------------- | ------------------------------------------- |
| MQTT disconnected or stale          | availability `UNKNOWN`; last state retained   | restore broker path and verify exact topics |
| Device MCP unavailable              | no control calls; optional captured catalog   | restore server and recapture `tools/list`   |
| task state becomes `-1`             | reconcile; never infer success                | query both MQTT and Device MCP state        |
| source-state conflict               | retain nonterminal task and report conflict   | inspect capture and per-source timestamps   |
| fire result contains verdict fields | strip recursively and emit bounded diagnostic | inspect downstream contract drift           |
| telemetry unavailable               | task state unchanged                          | restore telemetry ingress independently     |

## Restart and recovery

On restart the Adapter loads nonterminal executions and their local tracks, queries current device
state, and reconciles without repeating start or fire side effects. If MQTT and Device MCP cannot
jointly confirm the execution, it returns `UNCERTAIN_EXECUTION_STATE` through the frozen protocol's
retryable transient-unavailable status. Identity or argument-hash mismatch is a permanent conflict.

## Validation

```bash
pnpm test:ugv-provider:unit
pnpm test:ugv-provider:contract
pnpm test:ugv-provider:integration
pnpm test:ugv-provider:security
pnpm test:ugv-provider:e2e
pnpm work:protected:check
pnpm work:generated:check
```

If Docker is unavailable, report Compose execution as `NOT_RUN_ENVIRONMENT_UNAVAILABLE`; the gRPC
E2E and mock Device MCP smoke remain valid component-level evidence but do not prove container or
real ISR interface conformance.
