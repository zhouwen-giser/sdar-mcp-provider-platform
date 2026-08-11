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

## SDAR × SMPP Home-Lab Integration 支持追踪（2026-08-11）

本附录只追踪 Goal Run `019fca75-f48a-7780-ac5e-942503c6690e` 的当前候选树，不改变上表历史
Runtime V1.0 精确提交证据。`VERIFIED` 表示本 Goal 有对应真实/合同证据；`BLOCKED` 与
`DEFERRED_BY_SAFETY` 均不得提升为完成。

| Requirement | Phase | SMPP authority/scope | Evidence | Status |
| --- | --- | --- | --- | --- |
| Registry prerequisite and projection | G01-G03 | Native Registry remains authoritative; projection is read-only, byte-locked and checksum-compatible | `reports/sdar-integration-support/projection-contract.json`; `projection-http.json`; native protected-file diff empty | VERIFIED |
| SDAR Source support | G04 | Publish exact Climate/Light Candidates and native lineage; Registry creates no Tool/Task facts | `reports/sdar-integration-support/registry-lineage.json`; final post-restart Source replay | VERIFIED |
| Binding and live Catalog support | G05 | PMS/Runtime endpoints expose exact Climate 4 / Light 3 Tools; Binding/Runtime revisions converge at 17 | `reports/sdar-integration-support/provider-catalog.json`; SDAR Binding/Catalog reports | VERIFIED |
| Governed read-only support | G06-G07 | Exactly five capabilities/Skills at admission; Climate/Light read-only calls only; no physical write | SDAR `capability-map.json`, `skill-map.json`, `readonly-execution.json`; same-run replay | VERIFIED |
| A2A read-only | G08 | Live Light and Climate Runtimes each served one exact `get_state` call for a single SDAR A2A Task; Provider evidence was combined and remained queryable after the SDAR Runtime restart | Companion SDAR `reports/sdar-smpp-integration/a2a-readonly.json` and its byte-locked execute/restart raw reports | VERIFIED |
| Main-light, climate and composite writes | G09-G11 | Required physical-write gates absent; historical Home Assistant preparation is not promoted into this Goal | `reports/sdar-integration-support/light-control.json`; `climate-control.json`; no physical write attempted | DEFERRED_BY_SAFETY |
| Real resilience integration | G12 | Controlled/LKG/Adapter coverage exists; real in-flight restart, HA fault and corrupt-state cases absent | `reports/sdar-integration-support/recovery.json` | BLOCKED |
| Full cross-repository verification | G13 | SMPP candidate platform gates passed, but overall acceptance also requires the authoritative SDAR full gate | SDAR `reports/verification/summary.json`: Phase 13 Runtime P95 regression `39.981096754646735% > 10%` | BLOCKED (SDAR) |
| Task/device safety closeout | closeout | No physical write; no active or uncertain Goal Task; device state unchanged | SDAR `0/0`; SMPP `0/0`; device restore `RESTORED` | VERIFIED |
| Independent Draft publication | G14-G15 | Retained support branch and SDAR branch published independently; no merge, tag or release | SMPP PR #10 at `5b17f12`; SDAR PR #19 at `af887618`; final handoffs | VERIFIED (BLOCKED DRAFTS) |
| Overall readiness | G00-G15 | All Required readiness fields must be true | `crossRepositoryIntegrationReady=false`; `execplans/EP-SMPP-SDAR-HOME-LAB-INTEGRATION-SUPPORT.md` | BLOCKED |
