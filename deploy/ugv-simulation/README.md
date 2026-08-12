# Integrated PMS Console and real UGV simulator qualification stack

This Compose project runs the four-service PMS Console control plane alongside the SDAR UGV Adapter
and Runtime connected to an **external, real simulator**. Its eight persistent services are three
isolated PostgreSQL 17 databases, `pms-api`, `pms-worker`, `pms-web`, `ugv-adapter`, and
`ugv-runtime`. The optional one-shot UGV preflight container performs Device MCP discovery and
passive MQTT subscription; it never publishes MQTT messages or invokes a device tool. No simulator,
Device MCP, MQTT, Provider, or Runtime mock is included.

The PMS browser origin defaults to `http://127.0.0.1:8088`. It serves the API-mode production Web
build and proxies only `/api/console/v1/**` to the internal `pms-api` service. Neither the PMS API
nor Worker has a public host port, and the dedicated PMS database never shares a volume or
credentials with either UGV database.

The deployment deliberately uses the Runtime `test` safety profile because the in-project Adapter/Runtime links are plaintext inside an isolated bridge network. It is a qualification deployment, not a production security template.

## Configure

Requirements are Docker with Compose v2, Node.js 22 or newer for the host-side Runtime smoke client, and network reachability from Docker containers to the simulator.

```bash
cp deploy/ugv-simulation/.env.example deploy/ugv-simulation/.env
```

Edit `.env` before starting:

- Set `PMS_CONSOLE_SECRET_ROOT` to the absolute external directory prepared according to
  [the PMS secret guide](../pms-console/secrets/README.md). Console authentication is deferred, so
  its management and Runtime descriptors remain empty and PMS Web sends no `Authorization` value.
- Keep the default loopback PMS Web binding unless another explicitly controlled host binding is
  required. `PMS_WEB_PORT` is configurable and defaults to `8088`.
- For a simulator on the Docker host, use `host.docker.internal` in both URLs. Linux support is provided by `host-gateway`.
- For another machine, use its routable LAN IP or DNS name. Host networking is neither used nor required.
- Keep credentials out of URLs. Put the MQTT password and Device MCP authorization headers in absolute-path files described in [secrets/README.md](secrets/README.md).
- Set `UGV_MQTT_WIRE_MODE` to the explicitly captured bridge profile: `ros_bridge_json` for the current heterogeneous ROS bridge, or `ros_message_json`/`direct_domain_json` only when a later passive capture proves that the whole stream uses that envelope. `auto` and the example placeholder fail closed.
- Replace both database password placeholders with different URL-safe random values. The databases expose no host ports and the values are only for this local qualification stack.

`up.sh` and `smoke.sh` parse `.env` as data; they never source or execute it. Every configured secret-file path must be absolute, resolve outside the repository, name a regular non-symlink file, and have permissions no broader than `0600`. The PMS secret preflight additionally verifies its external directory layout, ownership, deferred-auth descriptors, and internal database credential consistency without printing secret content. Both commands reject staged, unstaged, or non-ignored untracked source changes; report artifacts under `reports/ugv-simulation/` are the only permitted working-tree exception. For the build itself, `up.sh` materializes an immutable context with `git archive` from the exact printed Git SHA. Ignored files, local build output, `.codex`, real `.env` files, reports, and secret files therefore cannot enter the qualified build context; `.dockerignore` repeats the sensitive-file exclusions as defense in depth. The preflight scripts are copied from that immutable context into the revision-labeled Adapter image; Compose does not bind-mount qualification code from the working tree.

For `mqtts://` or `wss://`, set `UGV_SIM_MQTT_TLS_MODE=required` and provide CA, client certificate, and private-key files. For `https://` Device MCP, set `UGV_SIM_DEVICE_MCP_TLS_MODE=required`. Scheme/mode mismatches fail before the stack starts.

## Run

```bash
bash deploy/ugv-simulation/up.sh
bash deploy/ugv-simulation/smoke.sh
bash deploy/ugv-simulation/down.sh
```

`up.sh` is the one-click qualification entrypoint. It builds all five application images from the
same exact-HEAD archive, verifies their OCI revision labels, starts the three databases, performs
the existing read-only external UGV preflight, then starts PMS API, Worker, Web, UGV Adapter, and
Runtime in dependency order. After health convergence it automatically runs `smoke.sh`; the
separate smoke command above is available for an explicit repeat.

Missing endpoints, missing `get_status`/`get_capabilities`, a non-explicit wire mode, a rejected MQTT subscription, or no composite status sample on either canonical `status/ugv` or the observed compatibility alias `/ugv/status` produces `BLOCKED_EXTERNAL_ENV` and a non-zero exit before the UGV application containers start. If only the compatibility alias is observed, or publisher QoS differs from the supplied protocol, preflight reports `PASS_WITH_UPSTREAM_DRIFT` and permits the compatibility stack to start; those protocol gates remain failed and the overall qualification must remain `UGV_SIMULATION_PARTIAL` until canonical topic and QoS conformance are proven.

`smoke.sh` first verifies PMS database/API/Worker/Web health, all three PMS revision labels and
running image identities, an API-mode browser page, the same-origin Console read proxy, and local
rejection of a machine `/api/v1/**` route. It then verifies both UGV OCI revision labels and running
container image IDs, reruns preflight with Compose `--no-build`, and calls only these Runtime
operations:

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

The smoke requires MQTT and Device MCP connectivity plus fresh chassis telemetry. It writes a redacted, bounded report to `reports/ugv-simulation/READ_ONLY_SMOKE.json`. Payload bodies, coordinates, credentials, and raw MQTT messages are not stored.

The full Device MCP contract captured by the Adapter and the preflight result persist in the `ugv-contract-reports` named volume. `down.sh` preserves all PMS and UGV named volumes; it does not silently erase databases, Worker state, or evidence.

## Safety and restart proof

All control, reconnaissance, and effector switches default to false. These lifecycle scripts contain no mutating Runtime calls. Empty point, waypoint, or reconnaissance fixtures are recorded as `NOT_EXECUTED_SAFE_FIXTURE_MISSING`; no coordinates are synthesized.

Use the following acceptance sequence after the first smoke passes:

```bash
bash deploy/ugv-simulation/down.sh
bash deploy/ugv-simulation/up.sh
bash deploy/ugv-simulation/smoke.sh
bash deploy/ugv-simulation/down.sh
bash deploy/ugv-simulation/up.sh
bash deploy/ugv-simulation/smoke.sh
```

The second preflight, Runtime readiness probe, and state read prove clean reconnect against the same external services. If a command fails, inspect `docker compose --project-name sdar-ugv-simulation-real --env-file deploy/ugv-simulation/.env -f deploy/ugv-simulation/compose.yaml ps` and the relevant service logs. Do not paste logs containing authorization material into evidence.
