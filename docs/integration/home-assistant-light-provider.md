# Home Assistant Light Provider integration

`builtin.home-assistant.light` is a separate logical Provider from the Climate Provider. Its public identity is `providerType: home_assistant.light`, `protocolMode: frozen_v1`, and its public resources are the configured `resourceId` values; Home Assistant Entity IDs remain local adapter configuration.

The first version exposes:

- `light_get_state` as synchronous read-only execution.
- `light_set_power` as task-required execution.
- `light_set_brightness` only when the configured capability permits it; brightness is never fabricated for a light that does not report it.

The Adapter owns the Home Assistant REST/WebSocket connection, allowlist, durable Provider state, confirmation worker, task-id idempotency and actual-state confirmation. PMS owns Provider, Resource, Config, Catalog, Registry and Deployment authority. The MCP Tasks Runtime owns Task and command lifecycle. Neither PMS nor Runtime calls Home Assistant directly.

Real writes require both `ALLOW_REAL_DEVICE_SIDE_EFFECTS=YES` and a non-empty unique `REAL_DEVICE_TEST_RUN_ID`. Every write re-reads state before invocation, observes the actual state after invocation, and stays inside the bounded per-resource write budget. Missing either gate is read-only.

The current live qualification is recorded in `reports/real-device-preparation-continuation/three-device-e2e.json`. It proves both configured lights through the PMS Registry-backed Runtime, including terminal `tasks/get`, actual-state confirmation, duplicate same-argument Task handling and different-argument conflict rejection. It does not certify every Home Assistant light.
