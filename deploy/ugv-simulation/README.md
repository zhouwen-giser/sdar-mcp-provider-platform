# Real UGV simulator qualification stack

This Compose project connects the SDAR UGV Adapter and Runtime to an **external, real simulator**. It starts only two private PostgreSQL services, the UGV Adapter, and the Runtime. The optional one-shot preflight container performs Device MCP discovery and passive MQTT subscription; it never publishes MQTT messages or invokes a device tool. Dedicated final-image targets contain only the Runtime or UGV Adapter application artifact plus shared packages; mock and simulator applications are not present in those images.

The deployment deliberately uses the Runtime `test` safety profile because the in-project Adapter/Runtime links are plaintext inside an isolated bridge network. It is a qualification deployment, not a production security template.

## Configure

Requirements are Docker with Compose v2, Node.js 22 or newer for the host-side Runtime smoke client, and network reachability from Docker containers to the simulator.

```bash
cp deploy/ugv-simulation/.env.example deploy/ugv-simulation/.env
```

Edit `.env` before starting:

- For a simulator on the Docker host, use `host.docker.internal` in both URLs. Linux support is provided by `host-gateway`.
- For another machine, use its routable LAN IP or DNS name. Host networking is neither used nor required.
- Keep credentials out of URLs. Put the MQTT password and Device MCP authorization headers in absolute-path files described in [secrets/README.md](secrets/README.md).
- Set `UGV_MQTT_WIRE_MODE` to the explicitly captured bridge profile: `ros_bridge_json` for the current heterogeneous ROS bridge, or `ros_message_json`/`direct_domain_json` only when a later passive capture proves that the whole stream uses that envelope. `auto` and the example placeholder fail closed.
- Replace both database password placeholders with different URL-safe random values. The databases expose no host ports and the values are only for this local qualification stack.

`up.sh` and `smoke.sh` parse `.env` as data; they never source or execute it. Every configured secret-file path must be absolute, resolve outside the repository, name a regular non-symlink file, and have permissions no broader than `0600`. Both commands reject staged, unstaged, or non-ignored untracked source changes; report artifacts under `reports/ugv-simulation/` are the only permitted working-tree exception. For the build itself, `up.sh` materializes an immutable context with `git archive` from the exact printed Git SHA. Ignored files, local build output, `.codex`, real `.env` files, reports, and secret files therefore cannot enter the qualified build context; `.dockerignore` repeats the sensitive-file exclusions as defense in depth. The preflight scripts are copied from that immutable context into the revision-labeled Adapter image; Compose does not bind-mount qualification code from the working tree.

For `mqtts://` or `wss://`, set `UGV_SIM_MQTT_TLS_MODE=required` and provide CA, client certificate, and private-key files. For `https://` Device MCP, set `UGV_SIM_DEVICE_MCP_TLS_MODE=required`. Scheme/mode mismatches fail before the stack starts.

## Run

```bash
bash deploy/ugv-simulation/up.sh
bash deploy/ugv-simulation/smoke.sh
bash deploy/ugv-simulation/down.sh
```

`up.sh` builds the two application targets from that exact-HEAD context, verifies their `/app/dist/apps` allowlist, runs preflight in the Compose bridge network, and then uses bounded `docker compose up --wait`. Missing endpoints, missing `get_status`/`get_capabilities`, a non-explicit wire mode, a rejected MQTT subscription, or no composite status sample on either canonical `status/ugv` or the observed compatibility alias `/ugv/status` produces `BLOCKED_EXTERNAL_ENV` and a non-zero exit before application containers start. If only the compatibility alias is observed, or publisher QoS differs from the supplied protocol, preflight reports `PASS_WITH_UPSTREAM_DRIFT` and permits the compatibility stack to start; those protocol gates remain failed and the overall qualification must remain `UGV_SIMULATION_PARTIAL` until canonical topic and QoS conformance are proven.

`smoke.sh` requires the exact-SHA images and running containers previously created by `up.sh`. It verifies both OCI revision labels and the running container image IDs, then reruns preflight with Compose `--no-build`; a missing or stale image fails closed instead of falling back to the repository working tree as a build context. It then calls only these Runtime operations:

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

The smoke requires MQTT and Device MCP connectivity plus fresh chassis telemetry. It writes a redacted, bounded report to `reports/ugv-simulation/READ_ONLY_SMOKE.json`. Payload bodies, coordinates, credentials, and raw MQTT messages are not stored.

The full Device MCP contract captured by the Adapter and the preflight result persist in the `ugv-contract-reports` named volume. `down.sh` preserves all named volumes; it does not silently erase databases or evidence.

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
