# UGV Provider Pre-Simulator Hardening — Final Report

## Outcome

**`UGV_PROVIDER_PRE_SIM_READY`**

The Provider is ready to begin simulator qualification. This does **not** mean the Provider is qualified against a simulator or real vehicle.

- Branch: `codex/ugv-provider-pre-simulator-hardening`
- Base/current committed SHA: `2e0626f2b2159d7c11061625c15274863479e217`
- Delivery form: uncommitted worktree patch and ZIP; no push or PR was performed
- Simulator availability: unavailable

## Required readiness labels

```text
LIVE_MODE_READY
CONTRACT_GATE_READY
EVIDENCE_MODEL_READY
CONTROL_CONFIRMATION_READY
RETRY_HEALTH_READY
PREFLIGHT_READY
PRODUCTIZATION_READY
SIMULATOR_QUALIFICATION_PENDING
```

## Layered readiness

| Layer                                          | Status                                     |
| ---------------------------------------------- | ------------------------------------------ |
| Local implementation/configuration             | `LOCAL_IMPLEMENTATION_PASS`                |
| Mock Device MCP contract semantics             | `MOCK_CONTRACT_PASS`                       |
| Deterministic MQTT/physical evidence semantics | `DETERMINISTIC_OBSERVATION_PASS`           |
| Real Device MCP                                | `PENDING_SIMULATOR_CONTRACT`               |
| Real MQTT                                      | `PENDING_SIMULATOR_OBSERVATION`            |
| Real movement/E-Stop/Recon                     | `PENDING_SIMULATOR_PHYSICAL_QUALIFICATION` |

## Acceptance gates

| Gate                | Result | Evidence                                                                        |
| ------------------- | ------ | ------------------------------------------------------------------------------- |
| A0 baseline/scope   | PASS   | latest main baseline, drift report, frozen protocol unchanged                   |
| A1 LIVE mode        | PASS   | simulation default, live first-class, mismatch fail-closed, live mock forbidden |
| A2 identity         | PASS   | configured Provider/Resource/private entity propagation and persistence         |
| A3 fire safety      | PASS   | default/production disabled, availability/direct start reject, zero calls       |
| A4 contract gate    | PASS   | per-operation compatibility profile; external contract pending                  |
| A5 evidence/fence   | PASS   | durable pre-dispatch baselines and new/fresh/correlated proof                   |
| A6 navigation facts | PASS   | objective baseline, terminal, displacement and authority facts                  |
| A7 task controls    | PASS   | ACK separated from physical pause/resume/cancel proof                           |
| A8 emergency stop   | PASS   | missing/stale speed fails closed; fresh stationary proof required               |
| A9 Recon model      | PASS   | rich facts and strict/weak/mismatch correlation states                          |
| A10 retry/health    | PASS   | existing resilience integrated; mutating calls never auto-replayed              |
| A11 preflight       | PASS   | zero-side-effect script reports `BLOCKED_BY_SIMULATOR` truthfully               |
| A12 recovery        | PASS   | no duplicate deterministic start; PostgreSQL fence persistence                  |
| A13 observability   | PASS   | named bounded-cardinality metrics and transition events                         |
| A14 regression      | PASS   | affected UGV/shared/NPC/config/bundle/build checks passed                       |

## Product behavior

- Production bundle uses `live`, PostgreSQL, real Device MCP, fire disabled and no Mock fallback.
- One Provider instance owns one configured public UGV Resource; the private downstream entity remains internal.
- Navigation requires correlated terminal mission plus new/fresh position and speed and stationary completion.
- Pause/Resume/Cancel persist a post-command baseline before calling the device.
- Emergency stop needs fresh post-dispatch stop evidence and inactive owned tracks.
- Recon exposes objective progress/coverage/target/fault facts without inventing a missing run identifier.
- Operation health adds `HEALTHY/DEGRADED/OPEN/RECOVERING` hysteresis without changing the frozen protocol.
- Engineering profile fields exist as typed nullable/unconfigured facts and contain no guessed values.

## Regression summary

The affected UGV/Device-MCP/shared-NPC deterministic suites passed 117 tests across 10 files; UGV gRPC plus PostgreSQL platform/recovery passed 5 tests across 3 files; production-bundle and local-preflight Node tests passed 35 tests. Configuration generation, TypeScript, ESLint, build, protected-file and generated-artifact checks also passed. See `REGRESSION.json` for runner/environment details.

## Simulator handoff

- Human-readable: `reports/ugv-provider-pre-simulator/SIMULATOR_DEPENDENCY_MATRIX.md`
- Machine-readable: `reports/ugv-provider-pre-simulator/SIMULATOR_DEPENDENCY_MATRIX.json`

The matrix enumerates exact tools, topics, fields, ordering/correlation requirements and physical scenarios. No entry is marked externally passed.

## Delivery

The delivery directory contains the ZIP, SHA-256 sidecar and full binary-capable patch. See `KNOWN_LIMITATIONS.md` before qualification.
