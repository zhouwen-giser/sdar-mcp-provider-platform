# Goal 11 start gate — Goal 10 inheritance readiness

Status: `PASS_GOAL11_BRANCH_CREATION_ALLOWED`

Generated at: `2026-08-10T10:00:51Z`

## Selected base

| Field                                  | Value                                         |
| -------------------------------------- | --------------------------------------------- |
| `GOAL10_BASE_REF`                      | `codex/goal-10-ugv-simulation-real-interface` |
| `GOAL10_BASE_SHA`                      | `ac3369ba9fa4e0ff6b6589525594b50291da02b7`    |
| `GOAL10_UGV_STATUS`                    | `UGV_SIMULATION_PARTIAL`                      |
| `GOAL10_PMS_CONSOLE_STATUS`            | `PMS_CONSOLE_PACKAGE_QUALIFIED`               |
| Working tree before readiness evidence | clean                                         |
| Local/remote Goal 10 SHA               | equal                                         |

The local Goal 10 branch wins the `START_GATE.md` priority order. Its HEAD includes the final PMS evidence and delivery envelope. The qualified UGV product SHA remains `e1473ea6c7ea61ef0495e85cf19b6f7256143791`; there is no diff from that product SHA to the selected base in the UGV Adapter, shared vehicle packages, Provider Adapter kit, Runtime configuration contract, or UGV Provider Package.

## UGV partial-base decision

The UGV result is partial because the real publisher did not expose canonical `status/ugv`, published `/ugv/speed` at QoS 0 instead of expected QoS 1, and real control/recon were safety-disabled without coordinate fixtures. These are external protocol and safety-capability gaps, not shared infrastructure defects.

The required shared foundations are available:

- real Streamable HTTP Device MCP connection and 15-tool capture passed with mock fallback disabled;
- structured result/error validation, integer mission-ID chaining, uncertain-mutation no-retry, and per-tool circuit recovery passed deterministic tests;
- MQTT subscription, payload guards, topic profiles, state normalization, stale/duplicate handling, and reconnect/resubscribe passed;
- chassis `MissionState` and recon `MotionStatus` use independent validated mappings;
- Adapter restart reconciliation, duplicate task replay, conflicting task identity rejection, and clean real Compose restart passed;
- the UGV Provider exposed the final 11-operation shared Runtime catalog and passed 39 Provider tests plus the 49-test Goal 10 suite.

## PMS Console prerequisite

The PMS Console addendum is qualified. Current evidence proves frozen Console contract conformance at 36/36 operations, production API/Worker composition, real API-mode PMS Web, Registry E2E, and unified Compose packaging. Goal 11 can therefore use PMS API/Application onboarding and live Registry authority without rebuilding Goal 10 PMS architecture.

## Required artifacts

- `reports/ugv-simulation/UGV_SIMULATION_QUALIFICATION_REPORT.md`
- `reports/goal-10-pms-console-addendum/FINAL_REPORT.md`
- `deploy/ugv-simulation/compose.yaml`
- `deploy/pms-console/compose.yaml`
- `deploy/pms-console/up.sh`
- `deploy/pms-console/smoke.sh`

All are present at the selected base.

## Decision

Goal 11 branch creation is allowed from exact SHA `ac3369ba9fa4e0ff6b6589525594b50291da02b7`.

No NPC endpoint was inspected and no real control, reconnaissance, effector, or MQTT publish action was attempted during this start-gate review.
