# Runtime V1.0 需求追踪入口

Phase R0 已完成真实仓库核验。持续维护的详细矩阵位于
[`docs/implementation/requirement-traceability.md`](docs/implementation/requirement-traceability.md)。
下表保留为根目录索引；状态以详细矩阵和各 Phase 报告为准。

| Requirement | 设计依据 | Phase | 预期实现位置 | 必须测试 | 状态 |
|---|---|---|---|---|---|
| RQ-MCP | Profile 5-8、33 | R2-R6 | `packages/mcp-protocol`, `apps/runtime` | contract/e2e | VERIFIED (R6 CI) |
| RQ-REG | Runtime 4 | R2 | `packages/operation-registry` | unit/integration/security | VERIFIED (R2 CI) |
| RQ-ADAPTER | Adapter 4-15 | R1-R8 | `proto`, `packages/adapter-protocol`, examples | proto/contract/cross-language | VERIFIED (R8 CI) |
| RQ-STATE | Profile 5、17、24；Runtime 5 | R3-R6 | `packages/domain`, `packages/task-engine` | state matrix/terminal CAS | VERIFIED (R6 CI) |
| RQ-ADMISSION | Runtime 6、8、10 | R3-R7 | task engine/PostgreSQL repositories | PG/gRPC crash-window/recovery | VERIFIED (R7 CI) |
| RQ-AVAIL | Profile 8-11 | R4 | domain/task engine/MCP/gRPC | four-state/window/unknown E2E | VERIFIED (R4 CI) |
| RQ-TIME | Profile 12-15 | R5 | scheduler/domain/PostgreSQL claims | fake-clock/restart/multi-worker | VERIFIED (R5 CI) |
| RQ-CANCEL | Profile 23、36 | R6-R7 | task control/Adapter gateway | safe-stop/race/replay | VERIFIED (R7 CI) |
| RQ-INPUT | Profile 22 | R6 | task engine/PostgreSQL repositories | update/idempotency | VERIFIED (R6 CI) |
| RQ-IDEMP | Profile 29 | R3-R5 | advisory-lock persistence/domain | duplicate/concurrent/reconcile | VERIFIED (R5 CI) |
| RQ-OBS | Profile 17-18、32 | R6 | observation/outbox repositories | revision/delivery | VERIFIED (R6 CI) |
| RQ-RECOVERY | Profile 30 | R3-R7 | recovery manager | restart/fault | VERIFIED (R7 CI) |
| RQ-PERSIST | Runtime 8 | R2-R7 | `migrations`, PostgreSQL package | migration/integration | VERIFIED (R7 CI) |
| RQ-SEC | Profile 20、34-35 | R2、R7 | security and protocol boundaries | auth/mode/fuzz | VERIFIED (R7 CI) |
| RQ-OBSERVABILITY | Runtime 12 | R1、R7-R9 | `packages/observability` | metrics/log redaction | VERIFIED (R7 CI; R9 RUNBOOK) |
| RQ-CONFORMANCE | Profile 37-39 | R8-R9 | `packages/conformance-testkit` | P0-P4/cross-language | VERIFIED (R8 CI) |
| Deployment/operations | Task package R9 | R9 | `Dockerfile`, Compose, `deploy/kubernetes`, operations docs | container/manifest/health | VERIFIED (R9 CI) |
| Release integrity | Task package DoD | R9 | root scripts, CI, SBOM, changelog, reports | `pnpm verify`, audit, capacity | VERIFIED (READY PR / RC REF) |
