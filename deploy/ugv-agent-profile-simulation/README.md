# UGV Agent Profile external-simulation deployment

This isolated Compose profile connects the SMPP UGV Adapter to the laboratory simulator at
`mqtt://192.168.2.63:1883` and `http://192.168.2.63:19000/mcp`. It never starts the repository's
UGV MQTT broker, Device MCP mock, or MQTT publisher. It is external-simulation evidence only:
`productionEligible=false` and `physicalVehicleQualified=false`.

## Topology and frozen configuration

The fixed project `sdar-ugv-agent-profile-simulation` starts exactly four services:

- `ugv-agent-profile-adapter` and its own PostgreSQL database;
- `ugv-agent-profile-runtime` and its own PostgreSQL database.

This source-built Runtime loads the packaged Provider catalog and talks directly to the Adapter.
PMS/Registry and Redis are not Runtime dependencies in this topology, so starting unused instances
would not be minimal. The two PostgreSQL stores are the only required durable infrastructure. Root
Compose's default mock-provider services remain unchanged and are excluded from the explicit Goal
service closure used by `up.sh`.

The Profile freezes `UGV_EXECUTION_MODE=simulation`, `RUNTIME_ENV=test`,
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true`, `UGV_FIRE_ENABLED=false`,
`UGV_ALLOW_NAVIGATION_WITH_RECON=false`, `UGV_DEVICE_MCP_ALLOW_MOCK_CONTRACT=false`, and
`UGV_MQTT_WIRE_MODE=ros_bridge_json`. Plaintext transport is accepted only on this laboratory
simulation boundary. Database authentication uses PostgreSQL `trust` only inside the dedicated,
unpublished bridge network so no credential appears in rendered configuration or logs.

The endpoint values are not runtime-overridable. If the simulator later requires authentication,
stop and add reviewed secret-file mounts; never put credentials in a URL or an environment value.

## Run

From the repository root, one command performs frozen-contract verification, read-only external
preflight, image build, idempotent startup, Compose health convergence, and a local Runtime health
check:

```bash
UGV_SIMULATION_RUN_ID=uap-preflight-20260821-01 \
  bash deploy/ugv-agent-profile-simulation/up.sh
```

The preflight performs Device MCP `initialize`/`tools/list` and passive exact-topic MQTT
subscriptions only. It invokes no Device Tool and publishes no MQTT message. The lowercase run ID
must be unique and is validated before network access. Evidence is created once at
`reports/ugv-agent-profile-simulation/attempts/deployment-preflight-<run-id>.redacted.json`; an
existing identity is rejected and no latest file overwrites old evidence. A failed preflight
prevents long-running Goal services from starting and never falls back to a mock.

Before checking the frozen contract or opening a network connection, the runner atomically creates
`deployment-preflight-<run-id>.used.json` beside the expected evidence. This immutable reservation
is retained even if a later local or external gate fails, so retries must always use a new ID.

The Runtime MCP endpoint defaults to `http://127.0.0.1:19121/mcp`; the Adapter diagnostic port is
loopback-only at `127.0.0.1:17021`. Optional `UGV_AGENT_PROFILE_RUNTIME_PORT` and
`UGV_AGENT_PROFILE_ADAPTER_PORT` overrides exist only to resolve local port conflicts; the
validator still requires loopback binding and the documented defaults for acceptance.

## Lifecycle

```bash
export UGV_SIMULATION_RUN_ID=uap-p1-b02-<unique-id>
bash deploy/ugv-agent-profile-simulation/preflight.sh
bash deploy/ugv-agent-profile-simulation/up.sh
bash deploy/ugv-agent-profile-simulation/health.sh
bash deploy/ugv-agent-profile-simulation/qualify-provider-readonly.sh
bash deploy/ugv-agent-profile-simulation/logs.sh
bash deploy/ugv-agent-profile-simulation/down.sh
bash deploy/ugv-agent-profile-simulation/clean.sh
```

When preflight is run explicitly, `up.sh` consumes that exact immutable report and atomically burns a
separate deployment-start marker before Compose startup. It does not rerun preflight with the same
ID. Any failed startup or qualification attempt still consumes its run-specific marker; retry with
a new run ID.

Repeating `up.sh` while the same fixed project is already healthy performs only configuration and
health checks, so it creates neither resources nor evidence again. A new start after `down.sh`
requires a new run ID. `down.sh` is repeatable and preserves all Goal volumes. `clean.sh` uses only the
hard-coded Goal project and Compose's project-labelled volumes; it performs no global prune and
does not remove images or another project's data.

These lifecycle commands expose no remote shell, command runner, internal admin endpoint, Fire,
reconnaissance, tracking, gimbal, or effector authorization. Navigation remains governed by the
later shared SDAR confirmation/side-effect gate; this deployment task itself performs no control
call.

`qualify-provider-readonly.sh` consumes the same unique `UGV_SIMULATION_RUN_ID` as the successful
deployment preflight. It calls only Runtime northbound discovery, Catalog, point availability, and
one synchronous `vehicle_get_state`; it never dispatches navigation. The Adapter database
before/after audit must contain exactly one new `get_status` call and no execution, mutation,
command-ack, Fire, Recon, Track, Gimbal, or navigation row. Attempts are immutable under
`reports/ugv-agent-profile-simulation/attempts/`; the first passing run exclusively publishes
`smpp-provider-qualification.redacted.json` without overwriting older evidence.

Provider identity comes only from the public northbound `server/discover`
`io.sdar/providerCatalog` extension; operation/resource/schema/lifecycle facts come from
`tools/list`. Registry Snapshot and Node Control projection are intentionally deferred to
`UAP-P2-B02`, and the P1 report records those missing IDs as `null` rather than inventing lineage.

## Offline configuration gate

Render and validate without starting containers:

```bash
docker compose \
  --project-name sdar-ugv-agent-profile-simulation \
  -f compose.yaml \
  -f compose.ugv-agent-profile-simulation.yaml \
  --profile ugv-agent-profile-simulation \
  config --format json > /tmp/uap-compose.json
node scripts/ugv-agent-profile-simulation/validate-compose-profile.mjs \
  --compose-json /tmp/uap-compose.json
```

The validator computes the dependency closure of the four explicit `up.sh` targets. Root default
services and all built-in UGV mocks are rejected if they enter that closure.
