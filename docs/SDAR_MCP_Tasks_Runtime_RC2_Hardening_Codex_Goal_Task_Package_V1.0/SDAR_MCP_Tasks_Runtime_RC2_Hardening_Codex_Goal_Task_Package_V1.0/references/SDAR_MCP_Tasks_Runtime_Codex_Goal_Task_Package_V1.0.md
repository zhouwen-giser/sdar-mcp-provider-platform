# SDAR MCP Tasks Provider Runtime V1.0
## Codex Goal Mode 自动实施任务包

**任务包版本：** 1.0  
**日期：** 2026-07-16  
**目标交付：** 独立部署、语言无关的 SDAR MCP Tasks Provider Runtime  
**推荐实施分支：** `feature/mcp-tasks-provider-runtime-v1`  
**目标发布候选：** `v1.0.0-rc.1`  
**执行方式：** Codex `/plan` 完成真实仓库核验后进入 `/goal`，连续编码、测试、提交和推送，直到 Definition of Done 全部满足。

---

# 0. Codex 总指令

你需要在当前目标仓库中完成一个**真实可运行、可部署、可测试、可供跨语言资源团队接入**的 SDAR MCP Tasks Provider Runtime。你不能只输出设计、计划、伪代码或接口空壳。

最终产品由以下两部分组成：

```text
SDAR MCP Tasks Provider
├─ 通用 Runtime：本任务实现
└─ Resource Adapter：由 Java/Python/Go/C++/TypeScript 等业务团队实现
```

Runtime 必须统一承担：

```text
MCP Server 与 Streamable HTTP
SEP-2663 Tasks 生命周期
io.sdar/taskExecution Profile
Manifest 校验与动态 Tool 生成
Adapter gRPC/Protobuf 客户端
Task 持久化与标准状态机
Availability 与时间窗口
scheduled / startTolerance / maxElapsed
input_required / update / cancel
幂等、Observation、Outbox 与重启恢复
授权上下文和 execution mode 隔离
合规测试、镜像、部署样例和接入文档
```

Runtime **不是**：

- 跨 Provider 的全局资源调度中心；
- 任意资源的统一本体或控制平台；
- 车辆、NPC、仿真、批处理等领域逻辑的实现；
- 动态加载任意业务代码的插件系统；
- 依赖单一编程语言的 Adapter SDK；
- 用内存队列伪装的可靠长时任务服务。

## 0.1 权威输入优先级

发生冲突时，按以下优先级执行：

1. `references/SDAR_MCP_Tasks_Provider_Profile_V1.0.md`
2. `references/SDAR_MCP_Tasks_Runtime_Design_V1.0.md`
3. `references/SDAR_MCP_Tasks_Adapter_Design_V1.0.md`
4. 本任务包中已明确冻结的工程决策
5. 仓库既有风格与实现习惯

若仍有不可兼容冲突：记录到 `docs/decisions/ADR-xxx.md` 和 Phase 报告中，选择最符合 Profile 强制语义且可测试的方案，不要停在提问阶段。

## 0.2 Goal Mode 行为要求

- 开始时先真实阅读仓库、`AGENTS.md`、`PLANS.md`、README、CI、已有代码和测试。
- 建立并持续更新 ExecPlan；不得完成计划后停止。
- 除非缺少凭据、需要不可逆生产操作或出现不可消解的规范冲突，否则不要要求用户确认。
- 普通编译错误、测试失败、依赖兼容、迁移问题和代码重构不是停止理由，应自行修复。
- 每个 Phase 必须编码、测试、报告、独立提交并立即推送远程。
- 不允许把多个 Phase 压缩成一个最终提交。
- 不允许以 TODO、mock-only、跳过测试或“后续完善”宣告完成。
- 若仓库已经有实现，优先增量改造，不得无理由推倒重建。

---

# 1. 仓库启动与基线核验

## 1.1 Git 启动规则

执行：

```bash
git fetch origin --tags --prune
git status --short
git remote -v
git branch -a
git tag --sort=-version:refname | head -50
```

然后：

1. 识别默认分支，通常为 `main`。
2. 确认工作区干净；已有用户修改不得丢弃或覆盖。
3. 若目标分支不存在，从最新稳定默认分支创建：

```bash
git checkout <default-branch>
git pull --ff-only origin <default-branch>
git checkout -b feature/mcp-tasks-provider-runtime-v1
git push -u origin feature/mcp-tasks-provider-runtime-v1
```

4. 若分支已存在：

```bash
git checkout feature/mcp-tasks-provider-runtime-v1
git pull --ff-only origin feature/mcp-tasks-provider-runtime-v1
```

5. 禁止直接提交默认分支、禁止 force-push、禁止重写远程历史、禁止覆盖已有 Tag。
6. 若仓库为空或尚未初始化，则创建本地 Git 仓库和该功能分支；不得虚构远程地址。

## 1.2 Phase 0 前置核验

编码前必须输出：

```text
docs/implementation/current-repository-assessment.md
docs/implementation/runtime-exec-plan.md
docs/implementation/requirement-traceability.md
```

至少回答：

- 当前是否为绿地项目；
- 现有语言、包管理器、Node 版本、数据库和测试框架；
- 是否已有 MCP Server、Tasks、PostgreSQL、gRPC、Proto、Docker、CI；
- 哪些既有能力可复用；
- 哪些设计需要适配仓库结构；
- 当前基线测试和构建结果；
- 预计新增和修改的目录；
- 每个 Requirement 对应的实现 Phase 和测试。

未完成这些核验，不得大规模编码。

---

# 2. 冻结的工程决策

除非真实仓库已有成熟等价方案，V1.0 默认采用：

| 项目 | 冻结决策 |
|---|---|
| Runtime 实现语言 | Node.js 22 + TypeScript strict + ESM |
| 包管理 | pnpm workspace |
| MCP | 官方 TypeScript SDK；SEP-2663/实验性类型必须隔离在 `mcp-protocol` 边界内 |
| 对外传输 | Streamable HTTP 必须；stdio 仅允许作为开发辅助 |
| Adapter 主协议 | Protobuf + gRPC |
| 数据库 | PostgreSQL |
| 数据访问 | 显式 SQL/Repository；迁移文件为权威，不使用自动 schema sync |
| JSON Schema | Draft 2020-12 兼容验证器，默认 AJV；必须限制深度、大小和正则风险 |
| 调度 | PostgreSQL 持久状态 + 数据库扫描/租约；V1.0 不强制引入 Temporal、Hatchet、DBOS、BullMQ |
| 状态获取 | `GetExecution` 轮询必需，事件流可选，Reconcile 为恢复权威 |
| Manifest 更新 | 启动时加载，变更后重启；V1.0 不做热更新 |
| 日志 | 结构化日志，推荐 Pino |
| Observability | OpenTelemetry 接口 + Prometheus 风格指标 |
| 测试 | Vitest 或仓库已有等价框架；必须有真实 PostgreSQL/gRPC 集成测试 |
| 部署 | Dockerfile + Docker Compose；Helm 可作为产品化 Phase 输出 |

若仓库已有成熟替代组件，可复用，但必须证明满足相同语义和测试门槛，并在 ADR 中记录。

## 2.1 推荐仓库结构

Codex 应按真实仓库调整，但最终逻辑边界至少包含：

```text
apps/
  runtime/                    # 可部署 MCP Runtime 服务
packages/
  domain/                     # 无 SDK 污染的领域模型和状态机
  mcp-protocol/               # MCP SDK/SEP-2663 线协议隔离
  adapter-protocol/           # Proto、生成代码和 Adapter Gateway
  operation-registry/         # Manifest、Schema、Tool Catalog
  task-engine/                # 状态机、调度、取消、恢复
  persistence-postgres/       # Repository、迁移、Outbox
  observability/              # 日志、指标、Trace
  conformance-testkit/        # Provider/Adapter 合规测试
proto/
  io/sdar/mcp/tasks/adapter/v1/
migrations/
examples/
  mock-adapter-typescript/
  mock-adapter-python/
docs/
reports/runtime-v1/
```

---

# 3. 核心架构与责任边界

```text
SDAR / MCP Client
        │ Streamable HTTP + JSON-RPC
        ▼
┌─────────────────────────────────────┐
│ SDAR MCP Tasks Provider Runtime     │
│ MCP Server / Tool Catalog           │
│ Task Engine / Scheduler             │
│ Persistence / Idempotency / Outbox  │
│ Adapter Gateway / Reconcile         │
│ Security / Observability            │
└────────────────┬────────────────────┘
                 │ gRPC + Protobuf
                 ▼
┌─────────────────────────────────────┐
│ Resource Adapter                    │
│ Java / Python / Go / C++ / TS       │
│ Resource facts and real execution   │
└────────────────┬────────────────────┘
                 ▼
           Real resource platform
```

强制边界：

- Runtime 是 MCP Task 标准状态和持久化生命周期的权威。
- Adapter 是真实资源状态、最终准入、安全停止和执行结果的权威。
- Runtime 不根据本地猜测伪造资源成功或停止。
- Adapter 不直接返回或修改 SEP-2663 Task status。
- Provider 之间没有互斥；Runtime 只管理本部署单元内的 Task。
- 可选 `exclusive_by_resource_key` 只能减少显式冲突，最终准入仍由 Adapter 决定。

---

# 4. 功能需求

## RQ-MCP：MCP Server 与能力协商

必须实现：

- `initialize` 能力声明；
- `tools/list`；
- `tools/call`；
- `tasks/get`；
- `tasks/update`；
- `tasks/cancel`；
- `io.sdar/taskExecution/checkAvailability`；
- 可选 `notifications/tasks`，但查询必须始终正确；
- Streamable HTTP 路由与 Tasks 所需 `Mcp-Name`、`Mcp-Method`；
- Profile 能力根据 Runtime 与 Adapter Operation 能力求交集；
- 官方 SDK 类型不得扩散到 domain/task-engine/persistence。

## RQ-REG：Manifest 与动态 Tool

- 启动调用 `DescribeProvider`。
- 校验协议版本、Provider ID、Operation 唯一性、JSON Schema、安全限制和能力一致性。
- 保存不可变 `operation_snapshot` 和 manifest hash。
- 按 Operation 生成 Tool，不按资源实例生成 Tool。
- Runtime 不执行 Manifest 内任何代码、脚本或表达式。
- 历史 Task 固定引用创建时的 Operation Snapshot。
- `execution=synchronous` 与 `supportsScheduling=true` 属于非法组合。

## RQ-ADAPTER：跨语言 Adapter Protocol

规范 Proto 至少包含：

```text
DescribeProvider
CheckAvailability
StartOperation
GetExecution
RequestCancel
ReconcileExecution
UpdateExecution             conditional
PauseExecution              conditional
ResumeExecution             conditional
StreamExecutionEvents       optional
ListResources               optional
```

强制语义：

- 所有副作用方法包含稳定 taskId、argumentHash、executionMode、authorizationContextHash 和 attempt/command sequence。
- `StartOperation` 按 taskId 幂等；相同 taskId 不同参数/模式必须冲突。
- `GetExecution`、`ReconcileExecution` 无副作用。
- `RequestCancel` Ack 不代表已经停止。
- Event stream 不能替代 Get/Reconcile。

### 同步和异步 Operation 的协议冻结

为避免增加另一套业务调用协议，统一使用 `StartOperation`：

- `execution=synchronous`：Adapter 必须在调用预算内返回 accepted + **终态 initialSnapshot**；Runtime 返回普通 `CallToolResult`，不得创建 MCP Task。
- `execution=task_capable`：终态 initialSnapshot 返回普通结果；非终态 Snapshot 创建 Task。
- `execution=task_required`：接受后必须持久化并返回 `CreateTaskResult`；即使 initialSnapshot 已终态，也不得退化为同步普通结果。
- scheduled 调用只能用于 `task_capable` 或 `task_required`，接受后必须创建 Task。

若此冻结需要补充 Adapter Design，更新设计文档和 Proto 注释。

## RQ-STATE：Task 状态机

外部标准状态只能是：

```text
working
input_required
completed
failed
cancelled
```

内部至少包含：

```text
ADMISSION_PENDING
SCHEDULED
STARTING
QUEUED
RUNNING
PAUSED
RESUMING
INPUT_REQUIRED
STOPPING
TERMINAL_COMPLETED
TERMINAL_FAILED
TERMINAL_CANCELLED
```

强制映射：

| Adapter state | MCP result |
|---|---|
| ACCEPTED/SCHEDULED/QUEUED/RUNNING/PAUSED/RESUMING/STOPPING | `working`，对应 substate |
| WAITING_INPUT | `input_required` |
| SUCCEEDED | `completed + isError=false + success` |
| BUSINESS_FAILED | `completed + isError=true + business_failure` |
| PARTIALLY_COMPLETED | `completed + isError=true + partial_completion` |
| CANCELLED | `cancelled` |
| TECHNICAL_FAILED | `failed`，仅在无法形成正常 Tool Result 时 |

所有终态不可逆。终态前必须确认执行已稳定结束、不再产生副作用且结果已持久化。

## RQ-ADMISSION：最终准入与崩溃窗口

immediate task 调用：

```text
校验请求
→ 事务写 admission_intent + 稳定 taskId/idempotency
→ Adapter.StartOperation(taskId)
→ rejected：保存同步拒绝结果，不创建可见 Task
→ accepted：事务创建 provider_task + observation + outbox
→ commit 后返回 taskId
```

必须覆盖：

- Adapter 接受但 Runtime 响应前崩溃；
- StartOperation 响应丢失；
- DB 提交失败但真实执行已创建；
- 客户端重复 tools/call；
- Runtime 重启后对未决 admission intent 执行 Reconcile；
- 返回 taskId 前 `tasks/get` 必须立即可查。

## RQ-AVAIL：Availability

支持批量检查：

```text
available
restricted
disabled
unknown
```

- Availability 是预测，不是预留。
- restricted 必须包含 reasonCode、riskLevel、validUntil、possibleEffects。
- restricted 应返回 earliestStartTime 或 nextAvailableWindows；无法预测时返回 WINDOW_NOT_PREDICTABLE。
- Adapter 超时/暂时不可达时返回 unknown，不得伪装 available。
- actual `StartOperation` 始终重新完成最终准入。

## RQ-TIME：时间合同与持久调度

必须实现：

- immediate + startTolerance；
- scheduled + scheduledAt + startTolerance；
- maxElapsedMs 可为正整数或 null；
- latestStartAt、deadlineAt 的明确计算；
- scheduledAt 前不开始真实执行；
- scheduledAt 前等待不计入 maxElapsed；
- scheduledAt 后 queued/running/paused/input_required/retry 均计入；
- `start_window_missed`；
- `deadline_reached`；
- Runtime 重启后恢复所有持久定时；
- 不得仅依赖进程内 `setTimeout`。

## RQ-CANCEL：取消与安全停止

```text
tasks/cancel
→ 持久化 cancel_requested
→ Adapter.RequestCancel
→ substate=stopping
→ Get/Reconcile 确认真实停止和资源释放
→ 用户取消发布 cancelled
```

- Ack-only。
- 任务自然完成可以最终为 completed，不得强制伪造 cancelled。
- deadline 使用同一安全停止过程，但最终为 `completed + isError=true + deadline_reached`。
- Adapter 无法安全停止时，对应 Operation 必须关闭 maxElapsed 能力。

## RQ-INPUT：input_required

- 保存稳定 inputRequests 和唯一 key。
- `tasks/update` 只 Ack。
- 重复输入幂等，未知 key 不产生副作用。
- Adapter 后续 Snapshot 决定状态变化。
- input_required 时间计入 maxElapsed。

## RQ-IDEMP：幂等

绑定：

```text
authorization context
+ operationName
+ idempotencyKey
+ argumentHash
+ executionMode
```

相同组合返回原同步结果或原 taskId；同 key 参数不一致返回冲突。scheduled 重试不得创建多个预约 Task。

## RQ-OBS：Observation 与通知

- 每 Task 单调 revision。
- 不重复 revision，按升序返回。
- 保存 accepted/scheduled/started/paused/resumed/progress/heartbeat。
- 重复 Snapshot/Event 不重复推进状态。
- revision 跳跃允许通过完整 Snapshot 前进。
- Outbox 与 Task 状态同事务写入。
- 通知失败不得影响 `tasks/get` 正确性。

## RQ-RECOVERY：重启恢复

启动后扫描：

- SCHEDULED：恢复定时；
- ADMISSION_PENDING/STARTING：Reconcile，必要时相同 taskId 幂等重试；
- QUEUED/RUNNING/PAUSED/INPUT_REQUIRED/STOPPING：Reconcile；
- 终态：只恢复查询和 TTL；
- unknown/not-found：根据持久证据明确 retry/failed，禁止伪造成功。

同一 Task 的恢复必须串行。Provider ready 前必须完成迁移、Manifest 校验、Adapter 连通检查和恢复扫描启动。

## RQ-PERSIST：PostgreSQL

至少创建 Forward Migrations：

```text
provider_task
admission_intent
task_observation
task_input_request
idempotency_record
operation_snapshot
outbox_event
runtime_lease / scheduler_claim（若实现需要）
```

要求：

- 唯一约束、外键、状态 CHECK、version/CAS；
- JSON/JSONB 字段的清晰契约；
- 迁移不可修改已发布文件，只能新增；
- 空库迁移测试和升级迁移测试；
- 数据库暂时失败时不得丢失已确认 Task。

## RQ-SEC：安全和隔离

- Client→Runtime 支持可插拔鉴权；测试至少覆盖 JWT 或受信任测试身份。
- Runtime→Adapter 支持 mTLS 配置；本地开发可显式关闭。
- taskId 绑定授权上下文和 execution mode。
- `live`、`simulation`、`historical-replay` 不可交叉读取、更新、取消。
- 参数、状态、错误和日志脱敏。
- Manifest/Schema 限制大小、深度、复杂度。
- 防止 SSRF、命令注入、路径穿越和任意代码执行。
- taskId 至少 128 bit 随机性或等效不可猜测性。

## RQ-OBSERVABILITY：运维

至少提供：

- `/health/live`、`/health/ready`；
- 结构化日志；
- Task 状态、调用延迟、取消耗时、恢复次数、Adapter RPC、Outbox、幂等命中指标；
- Trace 关联 providerId/taskId/operationName/resourceRef/executionMode/correlationId；
- 日志中不得包含凭据或完整敏感 arguments。

---

# 5. 实施 Phase

每个 Phase 都必须：

1. 开始前 fetch、检查默认分支新提交和并行冲突；
2. 更新 ExecPlan；
3. 完成代码、测试、文档；
4. 运行本 Phase 验收命令；
5. 写 Phase 报告；
6. 独立 commit；
7. 立即 push；
8. 确认允许进入下一 Phase。

## Phase R0：真实仓库核验与设计冻结

**目标：** 完成基线分析、依赖验证、Repo 结构和 ADR。

交付：

```text
docs/implementation/current-repository-assessment.md
docs/implementation/runtime-exec-plan.md
docs/implementation/requirement-traceability.md
docs/decisions/ADR-001-runtime-stack.md
docs/decisions/ADR-002-task-persistence-and-scheduler.md
docs/decisions/ADR-003-adapter-protocol.md
```

退出门槛：基线构建/测试结果记录完整，所有需求有 Phase 映射。

提交：

```text
docs(runtime): freeze provider runtime implementation baseline
```

## Phase R1：项目骨架、Proto 与 Mock Adapter

**目标：** 建立可构建服务、Proto 契约、生成代码、PostgreSQL 和两个 Mock Adapter 框架。

必须完成：

- pnpm workspace、strict TS、lint/format/typecheck/build/test；
- Runtime 配置、日志、health；
- Adapter proto v1；
- TypeScript Mock Adapter；
- Python Mock Adapter 可启动并响应 DescribeProvider/GetExecution；
- Docker Compose 启动 Postgres + Runtime + Adapter；
- Proto 兼容检查和代码生成自动化。

退出门槛：Runtime 能通过 gRPC 读取 Manifest；Compose 健康。

提交：

```text
feat(runtime): establish runtime and adapter protocol foundation
```

## Phase R2：Operation Registry 与 MCP Tool Catalog

**目标：** Manifest 校验、Snapshot、动态 Tool 和 MCP 传输。

必须完成：

- Streamable HTTP MCP Server；
- capabilities；
- DescribeProvider 加载和重试；
- Manifest JSON Schema 校验；
- Operation Snapshot 持久化；
- tools/list；
- 同步 Operation 闭环；
- task_capable/task_required 发现元数据；
- 非法能力组合测试；
- Manifest 不执行代码的安全测试。

退出门槛：MCP Client 可发现并调用同步 Mock Tool；重启后 Snapshot 一致。

提交：

```text
feat(runtime): generate MCP tools from validated adapter manifests
```

## Phase R3：P0 Task Engine、持久化和 tasks/get

**目标：** 完成 Task 创建、状态机、基础轮询和终态映射。

必须完成：

- 核心迁移；
- Repository；
- admission_intent；
- immediate task_required/task_capable；
- StartOperation 最终准入；
- tasks/get；
- Adapter Snapshot→MCP 状态映射；
- 终态不可逆；
- 返回 taskId 前可查询；
- 业务失败与技术失败区分；
- crash-window 集成测试。

退出门槛：异步 Mock Task 从 call→working→completed 完整闭环；Runtime 重启后可查。

提交：

```text
feat(runtime): persist and execute SEP-2663 task lifecycle
```

## Phase R4：Availability、幂等与调用一致性

**目标：** 完成 P1 和重复调用安全。

必须完成：

- checkAvailability 批量调用；
- 四状态、risk、validUntil、时间窗口；
- unknown fallback；
- idempotency_record；
- 参数 hash 和冲突；
- 同步结果去重；
- 远程 taskId 去重；
- Admission intent 恢复；
- 多 Runtime 请求并发下不重复副作用。

退出门槛：重复/并发 tools/call 只创建一个真实执行。

提交：

```text
feat(runtime): add availability and end-to-end idempotency
```

## Phase R5：P2 持久调度与时间合同

**目标：** scheduled、startTolerance、maxElapsed 和恢复。

必须完成：

- SCHEDULED 状态；
- DB-backed scheduler/claim；
- latestStartAt/deadlineAt；
- 不早于 scheduledAt；
- start_window_missed；
- deadline stop orchestration；
- maxElapsed=null；
- 多实例 claim 安全；
- 重启后定时恢复；
- 时钟可注入，测试不依赖长时间 sleep。

退出门槛：时间合同矩阵和重启恢复测试全部通过。

提交：

```text
feat(runtime): enforce durable scheduling and task timing contracts
```

## Phase R6：update、cancel、input_required 与 Observation

**目标：** 补齐任务控制和审计语义。

必须完成：

- tasks/update；
- stable inputRequests；
- tasks/cancel Ack-only；
- STOPPING；
- 自然完成与取消竞争；
- user cancel vs deadline outcome；
- Observation revision；
- Outbox；
- 可选 notifications/tasks；
- Pause/Resume Gateway（按能力）；
- 重复事件/输入/取消幂等。

退出门槛：取消不会提前终态；input_required 多轮工作；Observation 无重复推进。

提交：

```text
feat(runtime): complete task control observation and safe cancellation
```

## Phase R7：Reconcile、故障恢复、安全和可观测性

**目标：** 接近 P4 生产可靠性。

必须完成：

- 启动恢复扫描；
- STARTING 响应丢失 Reconcile；
- Adapter 重启；
- 事件流中断→轮询/Reconcile；
- 数据库暂时故障；
- taskId 授权隔离；
- execution mode 隔离；
- mTLS 配置；
- 限流和输入限制；
- Metrics/Trace/结构化日志；
- readiness 状态。

退出门槛：故障注入测试通过，无非终态 Task 静默丢失。

提交：

```text
feat(runtime): harden recovery security and observability
```

## Phase R8：Conformance Testkit 与跨语言验收

**目标：** 证明不同语言 Adapter 可复用同一 Runtime。

必须完成：

- Adapter conformance CLI/Testkit；
- Provider Profile P0-P4 测试分组；
- TypeScript Mock Adapter 完整能力；
- Python Mock Adapter 至少实现 Manifest、Availability、Start/Get/Cancel/Reconcile 和一种 input_required 或 scheduled 场景；
- 동일测试场景在两个 Adapter 上执行；
- 协议错误、幂等冲突、状态回退、终态不可逆测试；
- 测试报告可机器读取。

退出门槛：两个语言 Adapter 均通过规定等级，Runtime 不含语言专属业务代码。

提交：

```text
test(runtime): add cross-language provider conformance suite
```

## Phase R9：产品化、文档、发布候选

**目标：** 形成资源团队可以直接使用的交付物。

必须完成：

- 多阶段 Dockerfile；
- Docker Compose 一键样例；
- Helm Chart 或清晰 Kubernetes manifests；
- 数据库迁移命令和升级说明；
- 配置参考；
- Runtime 运维手册；
- Adapter 接入快速开始；
- API/Proto 文档；
- reasonCode 与状态映射文档；
- 性能/容量基线；
- `CHANGELOG.md`；
- SBOM、依赖审计或等价检查；
- Draft PR 更新为 Ready；
- 全部验收通过后创建 `v1.0.0-rc.1`，不得覆盖已有 Tag。

提交：

```text
release(runtime): prepare SDAR MCP Tasks Runtime v1.0.0-rc.1
```

---

# 6. 测试和验收矩阵

## 6.1 必须提供的脚本

无论仓库内部工具如何组织，根目录必须有可发现的等价命令：

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:recovery
pnpm test:security
pnpm test:e2e
pnpm test:conformance
pnpm verify
```

`pnpm verify` 必须聚合发布门槛，不得静默跳过缺失的数据库、Docker 或 Proto 检查。

## 6.2 必须覆盖的真实场景

### 协议和 Tool

- 能力协商正确；
- tools/list 来自 Manifest；
- resource 实例变化不生成新 Tool；
- synchronous、task_capable、task_required；
- scheduled 与 synchronous 非法组合；
- SDK 类型未泄漏到 domain。

### Task 创建和幂等

- accepted 后立即 get；
- rejected 不创建 Task；
- 相同 idempotencyKey 返回原结果；
- 相同 key 不同参数冲突；
- StartOperation 响应丢失；
- Adapter 已产生执行但 Runtime DB 提交暂时失败；
- 两个 Runtime 请求并发只创建一次。

### 状态和结果

- working 各 substate；
- input_required；
- success；
- business_failure；
- partial_completion；
- technical failed；
- terminal state 不回退；
- revision 重复/跳跃/乱序。

### 时间

- immediate startTolerance；
- scheduled 不提前；
- start_window_missed；
- maxElapsed=null；
- deadline 包含 queued/paused/input；
- Runtime 在 scheduledAt 前后重启；
- 多实例 scheduler claim。

### 取消和控制

- cancel Ack 后仍 working/stopping；
- 底层确认后 cancelled；
- 取消期间自然成功；
- 重复 cancel；
- deadline 安全停止；
- Update unknown key；
- 重复输入；
- Pause/Resume 按能力。

### 恢复和故障

- Runtime 重启；
- Adapter 重启；
- PostgreSQL 短暂不可用；
- gRPC timeout；
- event stream 中断；
- Reconcile not-found/transient/conflict；
- Outbox 重复投递；
- 非终态 Task 不静默消失。

### 安全

- 跨用户 taskId 拒绝；
- live/simulation/replay 隔离；
- 超大/超深 Schema 和 arguments；
- 日志脱敏；
- 无任意代码加载；
- taskId 不可猜测；
- mTLS/认证错误。

---

# 7. 数据库和一致性要求

## 7.1 Task 创建顺序

```text
持久化可见 Task
→ Task 可立即查询
→ 返回 taskId
```

immediate 的 Adapter 准入前使用不可见 `admission_intent`，但一旦返回 `CreateTaskResult`，`provider_task` 必须已经提交。

## 7.2 终态发布顺序

```text
底层执行稳定结束
→ 资源已释放或隔离
→ 最终结果和 Observation 持久化
→ Task 进入终态
→ 对外可见/通知
```

## 7.3 并发控制

- Task 更新使用 version/CAS 或行锁。
- Scheduler/Reconcile 使用 lease 或 `FOR UPDATE SKIP LOCKED`。
- 同 Task 不允许两个 Worker 同时执行状态迁移。
- Outbox 发布使用幂等 eventId。
- 不允许以 Redis/内存作为 Task 权威存储。

---

# 8. GitHub 阶段交付规则

## 8.1 每阶段开始

```bash
git fetch origin --tags --prune
git status --short
git log --oneline --decorate -20
```

检查默认分支或并行修复分支的新提交。

## 8.2 并行冲突处理

若本任务与并行 bug-fix/hardening 修改同一文件：

1. 立即暂停冲突子任务；
2. 保留已完成的非冲突工作；
3. 写 `reports/runtime-v1/blockers/<date>-<topic>.md`；
4. 等待对应修复提交进入远程稳定分支；
5. 主动 merge 稳定分支到当前功能分支；
6. 不得覆盖或回退修复；
7. 重新运行受影响的测试后继续；
8. 禁止 force push 和静默解决冲突。

若 push 失败：保留本地 commit 和 SHA，记录真实错误，不创建重复 commit/Tag；修复认证或远程问题后继续推送。

## 8.3 Phase 报告

每阶段创建：

```text
reports/runtime-v1/phase-RN/
  implementation.md
  test-results.md
  changed-files.md
  upstream-sync.md
  known-issues.md
```

必须记录：

- 开始 SHA、结束 SHA；
- 上游最新 SHA；
- 修改文件；
- Migration/Proto 变化；
- 实际测试命令和结果；
- 失败及修复；
- 已知限制；
- commit SHA；
- push/PR 结果；
- 是否允许进入下一 Phase。

---

# 9. 禁止的捷径

严禁：

- 仅用内存 Map 保存 Task、幂等或 Adapter execution binding；
- 用进程内 setTimeout 作为唯一 scheduled/deadline 实现；
- 返回 taskId 后再异步写数据库；
- 将 Availability 当作资源预留；
- cancel Ack 后立即发布 cancelled；
- 用 `failed` 表达普通业务失败；
- Adapter 直接返回 MCP status；
- Runtime 自行猜测真实资源已停止；
- 每个 resourceId 生成一个 Tool；
- 从 Manifest 加载/执行脚本或模块；
- 事件流作为唯一状态来源；
- 跳过 Reconcile；
- 只提供同语言进程内 Adapter；
- 只写 Mock 而没有真实 PostgreSQL/gRPC/HTTP E2E；
- 修改已发布 Migration；
- 关闭失败测试以获得绿色 CI；
- 在最终报告中隐藏未完成项。

---

# 10. Definition of Done

只有全部满足才能声明完成：

- [ ] Runtime 是独立可部署服务，Streamable HTTP 可用。
- [ ] Profile 和 Adapter 设计的 MUST 需求均有代码和测试映射。
- [ ] Manifest 动态生成有限 Operation Tool，不按资源实例生成。
- [ ] synchronous/task_capable/task_required 语义完成。
- [ ] Task 返回前已持久化并立即可查。
- [ ] Availability 四状态和受限时间窗口完成。
- [ ] scheduled/startTolerance/maxElapsed 完成且可重启恢复。
- [ ] input_required/update/cancel 完成。
- [ ] 取消和 deadline 不提前发布终态。
- [ ] 业务错误与技术错误映射正确。
- [ ] 幂等、Admission crash window、Outbox、Observation revision 完成。
- [ ] Runtime/Adapter/数据库故障恢复测试通过。
- [ ] 授权上下文和 execution mode 隔离通过。
- [ ] TypeScript 与 Python 两个 Adapter 使用同一 Runtime 通过合规测试。
- [ ] Docker Compose 可一键运行端到端样例。
- [ ] 所有 Phase 有独立 commit、报告和 GitHub push 证据。
- [ ] `pnpm verify` 通过。
- [ ] 无未解释的 skipped test、TODO、临时兼容分支或静默降级。
- [ ] 文档、Migration、Proto、部署、运维、升级说明完整。
- [ ] Draft PR 已更新为 Ready，并形成 `v1.0.0-rc.1` 发布候选（权限允许时）。

---

# 11. 最终输出要求

Codex 完成后必须提供：

1. 实际最终架构及与设计稿的差异；
2. 关键目录和文件；
3. MCP 方法、Profile 能力和 Adapter RPC 清单；
4. 数据库迁移清单；
5. Task 状态机和状态映射；
6. Docker/本地启动命令；
7. 全部测试命令和真实结果；
8. 两个语言 Adapter 的 E2E 证据；
9. 故障恢复与安全测试证据；
10. 各 Phase commit SHA、GitHub push 和 PR；
11. Definition of Done 逐项结论；
12. 未完成项、限制和原因，不得隐瞒。

不要只给总结。必须提交可运行代码、迁移、Proto、测试、镜像和文档。
