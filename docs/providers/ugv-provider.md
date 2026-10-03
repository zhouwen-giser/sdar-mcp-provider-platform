# UGV Provider V1

当前共享部署及冻结 MCP 协议的调用方式见[UGV Provider MCP 服务接口与业务调用指南](../ugv-provider-mcp-api-guide.md)。以下内容保留 V1 初始设计背景；工具清单、数据库部署方式和任务字段应以当前指南及运行时发现结果为准。

The UGV Provider is an independent SDAR Runtime and Adapter deployment for one simulation vehicle.
It exposes exactly one Runtime-visible resource:

```yaml
resourceId: vehicle:ugv1
resourceType: isr.vehicle.ugv
displayName: UGV-1
```

The Adapter consumes only the twelve exact `/ugv/...` topics defined in the locked UGV profile.
It never subscribes with `#` or `+`, and it has no Referee, world, simulation-fault, NPC Tank or
Base64-image ingress. Southbound control uses Streamable HTTP MCP on port `19000`; a captured
`tools/list` is intersected with the fixed UGV allowlist before calls are permitted.

## Operation manifest

| Operation                    | Execution     | Cancel | Pause/Resume |        Input | Risk   |
| ---------------------------- | ------------- | -----: | -----------: | -----------: | ------ |
| `vehicle_get_state`          | synchronous   |     no |           no |           no | low    |
| `vehicle_get_payload_status` | synchronous   |     no |           no |           no | low    |
| `vehicle_get_targets`        | synchronous   |     no |           no |           no | low    |
| `vehicle_laser_range`        | synchronous   |     no |           no |           no | low    |
| `vehicle_navigate`           | task required |    yes |          yes |           no | medium |
| `vehicle_area_recon`         | task required |    yes |          yes |           no | medium |
| `vehicle_track_target`       | task required |    yes |           no |           no | medium |
| `vehicle_fire_weapon`        | task required |    yes |           no | confirmation | high   |
| `vehicle_emergency_stop`     | task required |     no |           no |           no | high   |

The internal tracks are `chassis`, `eo` and `weapon`. They remain Adapter-internal; the Runtime does
not model them as separate resources. Emergency stop preempts all three local tracks. A downstream
command acknowledgement never completes a task: terminal state comes from fresh MQTT or Device MCP
state confirmation.

## Fire boundary

`vehicle_fire_weapon` performs only one local UGV fire-control cycle. It enters `WAITING_INPUT`,
requires an MCP elicitation confirmation, rechecks target lock, payload readiness and stopped
chassis state, and then calls the two allowlisted local tools. Keys such as `hit`, `miss`,
`destroyed`, `damage`, `remaining_hp` and `friendly_fire` are recursively removed before any result,
Evidence, Business Event, telemetry body or execution ledger write. Success means only
`fire_cycle_completed`.

## Persistence and events

The Adapter database is separate from the Runtime database. Migration `024_ugv_provider.sql`
creates the execution ledger, command acknowledgements, Device MCP call audit, normalized state
snapshots and durable Business Event source log. `vehicle.execution` and `vehicle.health` provide
durable at-least-once replay; `vehicle.target` is best-effort live. Source sequence and stream
identity are stable across Adapter restart.

## Verification

```bash
pnpm verify:ugv-provider:work
```

The Work-mode gate uses file hashes instead of Git metadata and covers type/build, generated Proto
stability, unit, contract, integration, security and gRPC E2E tests.
