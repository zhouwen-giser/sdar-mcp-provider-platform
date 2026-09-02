# P10 stale-position admission qualification

Status: **PASS**

Qualification date: 2026-09-02  
Branch: `codex/smpp-mcp-tasks-ugv-diagnostic-support-v0.1`  
Implementation commit: `5bb17c87694a3d858d567f05fbc4fac182fdf255`

## Finding

The r8 GNSS-loss behavior reached the Provider correctly, but the Provider mapped an explicit
`UGV_STATE_STALE` navigation verdict to `UNKNOWN`. The frozen consumer rule allows ordinary
unknown availability by default, so the mapping could not enforce stale-input rejection.

The deployed fix maps an explicitly stale or uncorrelated `vehicle_navigate` position to
`DISABLED / UGV_STATE_STALE`. Transport uncertainty remains `UNKNOWN`; Adapter readiness and
Device connectivity remain independent from field-level navigation eligibility.

## Read-only r8 evidence

No Device, Referee, Task, navigation, lease, or diagnostic mutation was invoked for this
investigation.

- Candidate SDAR Task: `fcc80351-6c9a-48ce-bee8-a7246e825c5d`.
- Persisted Provider snapshots show `health.components.gnss=fault` from
  `2026-09-02T09:52:56.522Z` through `2026-09-02T09:53:06.110Z`.
- At fault onset, `deviceMcpConnected=true`, `mqttConnected=true`, and `deviceAvailable=true`;
  chassis and health continued to refresh while geodetic position authority remained frozen.
- At `2026-09-02T09:52:58.134Z`, ProviderOps reported coarse chassis freshness `0.006 s`; at
  `2026-09-02T09:52:58.143Z`, coarse health freshness was also `0.006 s`. This confirms that
  coarse aggregate freshness cannot substitute for geodetic field authority.
- The frozen position remained the reset baseline, approximately
  `lat=29.72049013, lon=106.81179413`. Benchmark independently observed the same
  `positionObservedAt` stop advancing for more than 3.25 seconds and become older than the
  3-second admission threshold.
- Read-only Device `get_status` calls at `09:52:56.535Z`, `09:52:56.836Z`, `09:52:57.870Z`,
  `09:52:58.912Z`, `09:52:59.961Z`, and `09:53:03.249Z` were all accepted in 8–16 ms. The
  fault was not a transport outage.

Therefore `READY` and `deviceAvailable=true` were correct connectivity statements, while
`UNKNOWN / UGV_STATE_STALE` was an incorrect operation-availability statement.

## Regression and full verification

The integration regression covers both paths:

1. aggregate chassis/health continues to advance while the geodetic field becomes stale;
2. GNSS becomes faulted, aggregate WGS84 updates are gated, and the geodetic authority remains
   frozen until healthy recovery.

Both paths now return `DISABLED / UGV_STATE_STALE`; after healthy position authority resumes,
the verdict returns to `AVAILABLE / UGV_AVAILABLE`.

- Focused UGV integration: 67/67 passed.
- `pnpm verify:ugv-provider`: format, lint, typecheck, build, proto, unit 12/12, contract 8/8,
  integration 67/67, security 4/4, and e2e 2/2 passed.
- Root `pnpm verify`: unit 206/206, contract 36/36, integration 336/336, recovery 9/9,
  security 53/53, e2e 9/9, TypeScript/Python conformance, capacity, SBOM, Kubernetes, image,
  and container checks passed. Dependency audit reported no high-severity vulnerability.

## Exact deployed instance

Provider MCP endpoint: `http://127.0.0.1:19100/mcp`

| Component | Image                                                                           | Image ID / digest                                                         | OCI revision                               | Started at                       | Restart count | State             |
| --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | -------------------------------- | ------------: | ----------------- |
| Runtime   | `sdar-ugv-simulation-real/runtime:5bb17c87694a3d858d567f05fbc4fac182fdf255`     | `sha256:27a749eaf48be631227464df91b596c6d889d97d1c70891a01b364ef08f40a47` | `5bb17c87694a3d858d567f05fbc4fac182fdf255` | `2026-09-02T10:09:56.621642020Z` |             0 | running / healthy |
| Adapter   | `sdar-ugv-simulation-real/ugv-adapter:5bb17c87694a3d858d567f05fbc4fac182fdf255` | `sha256:7b12feb02f6a7316633c99bbb65cfb0c7f4f0587cc0ef5aa3c179367701004cc` | `5bb17c87694a3d858d567f05fbc4fac182fdf255` | `2026-09-02T10:09:33.786730290Z` |             0 | running           |

Runtime readiness returned HTTP 200 with every dependency ready. Adapter authoritative readiness
was `READY / UGV_PROVIDER_READY`, with `deviceMcpConnected=true`, `mqttConnected=true`,
`initialObservationReceived=true`, and `recoveryComplete=true` at
`2026-09-02T10:09:37.212Z`.

The instance remains in `live` execution mode with the unchanged real southbound endpoints:

- Device MCP: `http://192.168.2.63:19000/mcp`
- MQTT: `mqtt://192.168.2.63:1883`

The post-deploy read-only smoke passed at `2026-09-02T10:11:02.857Z`–`10:11:03.206Z`.
`vehicle_get_state` returned HTTP 200/complete, all three connectivity fields true, and fresh
chassis evidence. `tools/list` returned 10 tools including `vehicle_navigate`. A separate
read-only availability probe returned `AVAILABLE / UGV_AVAILABLE` under recovered healthy GNSS.

## Zero-active and zero-mutation proof

- Adapter executions: total 5, active 0.
- Adapter diagnostic leases: total 6, active 0.
- Runtime Provider tasks: total 5, active 0.
- Runtime leases: total 0, active 0.
- Runtime task commands: total 2, active 0.
- Adapter mutation journal: total 10; latest intent remained
  `2026-09-02T09:10:38.415Z`, before this deployment.
- Latest execution update remained `2026-09-02T09:10:39.285Z`, before this deployment.
- All southbound calls added by qualification were read-only: `get_status`,
  `get_capabilities`, `ugv_area_recon_get_status`, and `ugv_area_recon_get_targets`.
- The current Device mission snapshot was `missionId=42365, state=3, speed=0`; frozen mapping
  defines state 3 as terminal `CANCELLED`, not active.

No Task, Execution, active lease, command, navigation, Device mutation, Referee mutation,
diagnostic arm, MQTT publish, or weapon call was created by qualification.
