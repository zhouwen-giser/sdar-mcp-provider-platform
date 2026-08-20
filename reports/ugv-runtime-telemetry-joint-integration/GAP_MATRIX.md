# UGV Runtime × Provider × Telemetry Gap Matrix

Baseline: SMPP `c3a26b45fd03f93583ed07ecd15f191f9c0b52e4`; Telemetry `d713f71b4c93f981d5bce05b65ed71f5ed5814b6`.

| Gate | Baseline finding | Required action | Initial status |
|---|---|---|---|
| G1 Cursor | Cursor codec and qualified PostgreSQL fix are present | Re-run static, PostgreSQL, startup, failure-order and restart gates | PASS |
| G2 Simulator contract | Prior human documentation exists; current machine contract not captured | Run read-only `initialize/tools/list` and passive MQTT capture from Provider network | IN PROGRESS |
| G3 Read-only | Existing UGV stack runs an older image and Compose declares simulation mode | Build current source, select live mode, verify state/capabilities/availability and zero active/uncertain | OPEN |
| G4 Provider telemetry | Client ignored per-event results and swallowed transport failures | Parse and validate every result; add bounded retry/queue/drop/close metrics and tests | IN PROGRESS |
| G5 Runtime OTLP | UGV Compose disabled OTLP and did not pin Runtime identity | Enable development OTLP with stable deployment/instance identity | IN PROGRESS |
| G6 Storage | Concurrent duplicate collection admitted multiple canonical WAL facts | Make classify+append atomic; verify duplicate/conflict and all ClickHouse layers | IN PROGRESS |
| G7 Point navigation | Safety switches are off | Do not submit until all read-only/telemetry gates and explicit live-control authorization pass | BLOCKED BY SAFETY GATE |
| G8 Correlation | No current joint-run record chain exists | Preserve provider/resource/task/execution/operation/record identities end to end | OPEN |
| G9 Rate/backpressure | Provider client had no explicit bounded queue/drop accounting | Add bounded behavior, measure intended rate and verify zero silent loss | IN PROGRESS |
| G10 Recovery | WAL checkpoint commits raced across projection targets | Serialize and durably merge checkpoints; run controlled outage/recovery tests | IN PROGRESS |
| G11 Regression | Baseline focused UGV/NPC and Telemetry tests pass | Run all affected build/test/lint/typecheck/config gates after fixes | OPEN |
| G12 Scope | Fire and live controls are disabled | Preserve fire=0, no direct Telemetry access to MQTT/MCP/databases, redact evidence | PASS/ONGOING |

The dedicated Goal safety rules override broader PRD examples: there is no distance, area-recon, cancel, pause/resume or emergency-stop control without its separate explicit authorization.
