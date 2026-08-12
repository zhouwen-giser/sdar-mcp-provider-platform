# NPC Tank real-simulator deployment

This directory is an NPC-only Compose overlay on the qualified Goal 10 PMS Console package. It
does not duplicate PMS definitions and it never starts a Device MCP, MQTT broker, simulator, or
Mock service. The combined project contains the four PMS services plus `npc-runtime-postgres`,
`npc-adapter-postgres`, `npc-tank-runtime`, and `npc-tank-adapter`. `npc-preflight` is an optional,
read-only profile used for real MCP `tools/list` capture and passive MQTT subscription.

## Prepare external configuration

Copy `.env.example` to `.env` and replace every absolute placeholder path. `.env` is parsed as inert
data by Docker Compose and the validator; no deployment script sources or evaluates it. The two
simulator URLs must be real addresses reachable from a container. `host.docker.internal` is wired to
the Linux host gateway. Loopback, credentials embedded in URLs, and hostnames identifying a Mock are
rejected.

Prepare the Goal 10 PMS secret tree exactly as documented in
`deploy/pms-console/secrets/README.md`. Separately prepare
`NPC_TANK_PMS_CREDENTIAL_ROOT` outside the repository. It is mounted read-only into PMS API and
Worker, so scoped Runtime/management credentials can be supplied without changing the authoritative
PMS Compose file. Descriptor `tokenFile` entries must use container paths below
`/run/npc-pms-credentials/`; the matching files live at the same relative paths in the external
root. At least one management administrator is required for formal onboarding. A minimal shape is:

```json
{
  "management": {
    "reader": [],
    "administrator": [
      {
        "subjectId": "REPLACE_WITH_OPERATOR_ID",
        "tokenFile": "/run/npc-pms-credentials/management-administrator.token"
      }
    ]
  }
}
```

`runtime.json` uses the PMS API's provider/deployment/instance-scoped `runtimeConfig` and
`runtimeRegistration` descriptors. Their token file and the Worker's
`PMS_RUNTIME_CONTROL_PLANE_CREDENTIAL_ROOT` both resolve below the external
`/run/npc-pms-credentials/runtime-control-plane` tree, so PMS API authentication and the PM2 child
use the same read-only credential without seeding a Docker volume. Do not put token text in either
JSON descriptor.

Create four independent database files. The password files contain only a generated password of at
least 16 characters; the URL files contain these internal URLs with the same password (percent
encoded where required):

```text
postgresql://npc_adapter:<password>@npc-adapter-postgres:5432/npc_adapter
postgresql://npc_runtime:<password>@npc-runtime-postgres:5432/npc_runtime
```

External credential directories must be mode `0700`; files must be regular, non-symlink,
singly-linked, non-empty, and no broader than `0600`. See `secrets/README.md` for the complete
layout. The validator compares database password/URL pairs in memory and never prints secret
contents.

## One click

From the repository root:

```bash
bash deploy/npc-tank-simulation/up.sh
```

`up.sh` rejects a non-Goal-11 branch or dirty tracked source (only
`reports/npc-tank-simulation/**` evidence may differ), materializes `git archive` from the exact
printed HEAD, builds all five local product images from that immutable context, verifies their OCI
revision/non-root/health metadata, starts the stack, runs real read-only preflight, and then runs the
smoke suite. The project name is always `sdar-npc-tank-simulation-real`; every lifecycle command
uses both Compose files explicitly.

The measured simulator broker currently mixes ROS bridge envelopes and direct-shaped payloads, so
the explicit compatibility value is `NPC_TANK_MQTT_WIRE_MODE=ros_bridge_json`. Goal 11's frozen
plan allows only `ros_message_json` or `direct_domain_json` for final qualification. This mismatch
is recorded as `SIMULATOR_INTERFACE_DEFECT_MIXED_MQTT_WIRE_SHAPES`; the compatibility mode must not
be silently relabeled as either allowed mode.

## Safety and qualification

`up.sh`, `smoke.sh`, and `qualify.sh` with no arguments are read-only: they perform health checks,
MCP discovery/read operations, and passive MQTT subscriptions only. They never enable movement,
reconnaissance, or effector calls. The deployment wrapper validates mutating gates with a second
explicit CLI opt-in but deliberately does not implement actuator execution:

```bash
bash deploy/npc-tank-simulation/qualify.sh --control
bash deploy/npc-tank-simulation/qualify.sh --recon
bash deploy/npc-tank-simulation/qualify.sh --effector
```

Control requires `NPC_TANK_ENABLE_REAL_CONTROL=true`, a distance in `(0,5]`, and both operator
supplied point/waypoint fixtures. Recon requires `NPC_TANK_ENABLE_RECON_TESTS=true` and an explicit
region fixture. Effector requires its own flag and remains outside core qualification. These
mutating invocations stop with `NOT_EXECUTED` after validation and read-only smoke; only the audited
Goal 11 runner that confirms command acceptance, observation transition, and terminal observation
may execute them. No coordinate is generated by this deployment.

After formal onboarding through PMS API/application flows and Worker reconciliation, set
`NPC_TANK_REQUIRE_PMS_REGISTRY=true`. Smoke then obtains the Runtime endpoint from the live Registry
snapshot, verifies revision/checksum/ETag/provider/server/catalog metadata and a sensitive-field
scan, and performs Runtime reads through that endpoint. When false, the script clearly reports
Registry as `NOT_EXECUTED` and uses the local published Runtime only for deployment readiness. The
deployment contains no `psql`, SQL, or direct PMS table mutation path.

The platform-managed Runtime is owned by Worker/PM2 and its Registry endpoint is deliberately a
loopback address in the PMS API/Worker shared network namespace. Registry-required smoke therefore
executes its endpoint probe in `pms-worker`; it does not rewrite the Registry URL or fall back to the
Compose Runtime URL. The endpoint, server ID, revision, checksum, ETag, and Catalog data still come
exclusively from the live Registry snapshot.

## Restart and teardown

The required clean restart sequence is:

```bash
bash deploy/npc-tank-simulation/down.sh
bash deploy/npc-tank-simulation/up.sh
bash deploy/npc-tank-simulation/smoke.sh
```

Repeat it once for recovery evidence. `down.sh` never passes `--volumes`; PMS/NPC PostgreSQL data,
PMS Worker state, and bounded contract evidence are preserved.
