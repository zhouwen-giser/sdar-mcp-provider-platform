# UGV Provider development template

This source-built stack defaults to Development Debug against the shared remote simulator. Running
`bash up.sh` with no profile selects `external`, Device MCP `http://192.168.2.63:19000/mcp`, MQTT
`mqtt://192.168.2.63:1883`, live execution, and all registered tool side effects. Startup preflight
and smoke remain read-only; later Runtime calls may invoke mutations.

It has two explicit, mutually exclusive connectivity profiles:

- `mock`: starts the repository mock Device MCP, an anonymous development MQTT broker, a mock publisher, the Adapter, Runtime and their separate PostgreSQL databases.
- `external`: starts no mock service. It first runs the real Device MCP and passive MQTT read-only preflight, then starts the Adapter and Runtime only if that preflight passes.

There is no automatic external-to-mock fallback. Both profiles keep
`UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT=false`. The default external profile enables the effector tool;
the explicitly selected mock profile disables it. This is a development template, not a production
security profile; mTLS is intentionally out of scope.

## Mock profile

Docker Compose v2, Docker Engine, Node.js 22 and the checked-out repository are required.

```bash
cd deploy/development/ugv-provider-template
bash up.sh mock
bash smoke.sh mock
bash down.sh mock
```

If `.env` is absent, the mock profile uses `.env.mock.example`. It publishes only loopback ports by
default: Runtime `19120`, Adapter `17010`, mock Device MCP `19020`, and mock MQTT `18830`.

## External profile

The checked-in `.env.example` already carries the Development Debug defaults for `192.168.2.63`.
Copy it to `.env` only to override endpoints or replace the development database passwords. Then
run:

```bash
bash contract-check.sh external  # read-only; no control or MQTT publish
bash up.sh                        # defaults to external Development Debug
bash smoke.sh                     # Runtime read-only calls only
bash down.sh
```

To enter Integration Candidate or Qualification, explicitly change `UGV_DELIVERY_STAGE` and use the
corresponding stage procedure. The development lifecycle scripts never promote the stage based on
health or source revision.

An external configuration that still resolves to `mock-ugv-device-mcp` or `mock-mqtt`, enables
mock-contract fallback, disables the full tool set, or uses simulation execution mode is rejected.
A failed external preflight stops startup and never selects `mock`.

Evidence is written under `reports/ugv-provider-template-stabilization/`. Endpoint credentials and raw MQTT payloads are not written.

## Controlled LIVE point validation

The LIVE runner targets exactly `longitude=106.81344630`, `latitude=29.72034353`, `altitude=500.000`. It refuses to dispatch without every explicit flag below and fresh access to both Runtime and Adapter databases:

```bash
export ALLOW_REAL_UGV_SIDE_EFFECTS=YES
export LIVE_TEST_RUN_ID="operator-unique-run-id"
export UGV_RUNTIME_MCP_URL="http://runtime-host:19100/mcp"
export UGV_TEST_RESOURCE_ID="vehicle:ugv1"
export UGV_LIVE_RUNTIME_DATABASE_URL="postgresql://..."
export UGV_LIVE_ADAPTER_DATABASE_URL="postgresql://..."
bash live-point-validation.sh
```

Before its one and only `vehicle_navigate(point)` request, the runner verifies Runtime readiness, protocol discovery, current state, stationary speed, a quiescent mission state (idle, ready, or successfully completed), zero active/uncertain Runtime tasks, the Tool catalog, and point-navigation availability. It never retries the mutating request or changes the idempotency key after an uncertain response. It polls only the returned/recovered Task identity and records the Adapter mutation journal and physical terminal evidence.

The previous rejected key `ugv-nav-20260818-10681344630` is forbidden. An authorization/precondition failure is recorded as blocked evidence; it is not a reason to dispatch another request.
