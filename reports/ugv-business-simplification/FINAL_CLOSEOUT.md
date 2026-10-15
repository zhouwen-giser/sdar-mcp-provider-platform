# UGV Provider MCP 业务简化与语义投影 v1.3 收口

后续交付更新：本轮实现已提交为 `0a4a7c3`，PR #35 已正式待审，sz-gowm 已升级。详见 [SITE_DELIVERY](SITE_DELIVERY.md)。以下保留实现验收当时的范围与证据。

审计日期：2026-10-03。基线 HEAD：`367910c75f4ffa3969aed1f612b77d74a6518ed4`。结论：全部 12 项任务及 ACCEPTANCE A–F 验收通过。`state/PROGRESS.json` 已将 12 项任务记录为 DONE，`UGV_PROVIDER_MCP_BUSINESS_SIMPLIFICATION_COMPLETE=true`。

本轮在 SMPP 既有调用链上实现 development 无身份门禁、live 默认、严格受约束的独占设备 Recon 推断，以及统一的业务语义投影。业务 binding、版本、时间、幂等和设备确认要求继续生效。`UGV_FIRE_ENABLED=false`。

## 逐项任务验收

以下项目逐一对应任务包 `TASKS.json` / `TASKS_DETAILED.md` 的退出条件。引用的测试结果和执行环境统一见 [VALIDATION](VALIDATION.md)，无需把历史现场记录解释为本轮新验收。

### UGVBIZ-001：真实基线和复用

- [BASELINE](BASELINE.md) 记录实际分支、HEAD、初始 index/worktree、任务包哈希和提取检查。
- [REUSE_MATRIX](REUSE_MATRIX.md) 对原实现标明 REUSE / CHANGE / OUT_OF_SCOPE。
- 基线 HEAD 和 index 保持不变，已有 v1.2 dirty 报告、证据和设备合同捕获保留；本轮未 reset、clean、stash 或覆盖上游实现。

### UGVBIZ-002：development 无身份门禁

- `packages/mcp-protocol/src/security.ts` 仅在服务端 `AUTH_MODE=development` 时创建固定内部来源；`packages/domain/src/business-responder.ts` 校验合法来源组合。
- 无 Authorization、JWT actor_type 或 x-sdar-actor-type 的公开 HTTP Input / Intervention 写入已经通过实际 Runtime → PostgreSQL → gRPC → Provider 链验证。
- 来源为 `development_anonymous`；Provider 审计 `verified=false`。客户端身份字段不提供权限，公开命令解析拒绝 `respondedBy`，服务端不以自填 actor header 伪造用户。
- `tests/security/runtime-security.test.ts` 与 `tests/contract/task-business-runtime-input-authorization.test.ts` 验证其他认证模式、scope 和所需 responder 类型仍受原有检查约束。
- 指南第 2 节说明认证边界及历史部署版本差异；没有建立新用户系统。

### UGVBIZ-003：业务保护和公共命令兼容

- `packages/vehicle-provider-core/src/task-business-interaction.ts` 仅对合法 development 来源跳过角色匹配；RequiredInput task/execution/request、revision、subject binding 和 deadline 检查继续执行。
- Runtime、PostgreSQL inbox、dispatcher、Provider 和现有业务 command ledger 贯通该内部来源，未增加公开命令 JSON 字段。原 ledger 可读；新增 responder 在受理后不可改写，恢复不拼造用户。
- `ugv-development-business-policy.test.ts`、`task-business-interaction.test.ts`、`task-business-command-service.test.ts`、`ugv-required-input-producer.test.ts` 及 PostgreSQL 用例覆盖上述正例、错误绑定、超期、冲突、故障恢复与重放。
- 公开 HTTP 导航用例确认错误 Execution、Intervention revision、effectivePlanRevision 被拒绝且不产生新计划；相同 commandId 等值重试可用，改值冲突。Input accept / decline / cancel 均有匿名答复正例。

### UGVBIZ-004：live 默认

- 配置 schema 原本默认 live，本轮将 `UgvProviderRuntime` 内部 fallback、能力矩阵、UGV 初始快照、preflight 和当前 GOWM 部署模板统一为 live。
- 省略 execution-mode / simulation-id 头的公开调用实际创建 LIVE Execution，不要求场景 ID。
- 显式 simulation 保留；对应旧仿真夹具显式声明 simulation，live/simulation 的正例与错配拒绝均有回归。
- 当前 `.env.gowm.example` 为 `AUTH_MODE=development`、`UGV_EXECUTION_MODE=live`、`UGV_FIRE_ENABLED=false`。

### UGVBIZ-005：live 导航与调整

- `packages/runtime-configuration-contract/src/providers/ugv.ts` 保留 isr_airport planner URL 与 ugv1 实体约束，移除 simulation-only 约束；Provider 依据真实 planner 和业务配置发布能力。
- `ugv-task-business-config.test.ts` 和 `ugv-provider-adapter.test.ts` 验证 live 导航 Profile 与缺少 planner 时 fail closed。
- 匿名 HTTP 用例通过受控 WebSocket planner 产生路线，等待对应 mission 状态后采用；调整同样等待旧任务停止、新任务执行，不以命令 ACK 伪造 route/adoption。
- 已完成 pause/resume 的审计记录可保留；只有尚待确认的控制阻塞调整。公开链路已验证暂停、恢复后成功调整路线。

### UGVBIZ-006：独占设备 Recon 推断

- 复用 `apps/ugv-provider-adapter/src/recon-execution-correlation.ts`，没有独立 Session 服务。
- 显式 mission/session 匹配为 STRICT_CORRELATED；缺 identity、当前资源唯一活动 Recon、fresh/non-retained 且严格晚于创建及 dispatch 边界才为 INFERRED_CURRENT_EXECUTION。
- 显式不匹配、identity 别名冲突、错误资源、无活动 Recon、多活动 Recon、stale、retained、执行前、边界同时间及终态后数据均拒绝。live 与 simulation 使用相同规则，重启不引入额外 generation 状态。
- 证据：`ugv-recon-execution-correlation.test.ts`、Provider AutoLock 和公开 HTTP 用例、[V-OBS](V-OBS.md)。

### UGVBIZ-007：AutoLock / RequiredInput 链

- `ugv-provider-auto-lock.test.ts` 的 live/simulation × strict/inferred × trusted/development × 三种决策矩阵覆盖两类关联进入业务链。
- fresh target 的 lock 命令使用 Execution 最新 mission ID；ACK、stage 2、旧命令时刻、其他目标、旧 mission 均不能建立本次 active Action。
- 只有命令之后 stage 3 + 同目标的有效观测才 active 并产生 Input；匿名答复可完成。
- decline/cancel 的 release ACK 不等于扫描恢复；仍等待绑定的后续设备扫描事实。HTTP 用例在原侦察任务上终止，使用设备 Recon control cmd_type=4。
- 交付：[V-OBS](V-OBS.md)、[V-INPUT](V-INPUT.md)。

### UGVBIZ-008：统一薄投影

- `packages/vehicle-provider-core/src/ugv-business-semantics.ts` 提供共享类型、Zod / JSON schema 和纯函数；schema 为 `ugv.business-semantics/1`。
- 覆盖 mission/task state、Recon phase、visual lock、sensor mode、payload health，并单列 payload load state。
- [映射合同](../../docs/providers/ugv-business-semantics.md) 为每类已知码列出现有 mapper/codebook 依据；load code 只有 4 能确定为 fault，其他未知整数保留且输出 unknown；regionType / targetTypes 不猜测。
- `ugv-business-semantics.test.ts` 验证已知码、缺失值、未知码、显式故障优先级和 UGV ingress 原值保留；未知值不驱动成功状态。NPC 原准入保持不变。

### UGVBIZ-009：同步查询

- UGV manifest 显式开启增量 businessSemantics 输出；`vehicle_get_state`、`vehicle_get_payload_status`、`vehicle_get_targets` 使用同一快照投影。
- `dto-schemas.ts` 与动态 manifest 同步包含新 schema；原 chassis / reconnaissance / targets 等 native 字段保留。
- Provider 合同测试将三类真实输出交给 manifest 输出 schema 验证，公开匿名 HTTP 用例验证可读结果；未知 native 整数可见且 semantic=unknown。NPC 不启用该扩展。

### UGVBIZ-010：TaskBusiness / Event

- `ReconBusinessProcessor` 在 Context summary 与 recon.motion_status_observed 事件（含 contextDelta.summary）调用相同源模型和投影函数，不引入第二个 reducer。
- 相同源经查询 / Context / Event 的结果一致；Context 是已归属执行的最近样本，不能与其他时刻查询强行比较。
- 同阶段内语义变化可发布事件，相同 source cursor 保持既有去重；原 correlationStrength / correlation 保留，inferred 不升级成 strict。
- `ugv-recon-business-processor.test.ts`、`ugv-provider-auto-lock.test.ts` 验证一致性、同阶段变化、未知值和关联来源。

### UGVBIZ-011：指南和部署示例

- [服务接口与业务调用指南](../../docs/ugv-provider-mcp-api-guide.md) 提供 discover、tools、查询、导航、调整、侦察、Input、事件恢复、取消与排障的完整流程。
- 普通示例默认 live，无 Authorization 和 simulationId；development 的匿名业务写入由服务端策略决定。显式 simulation 示例独立保留。
- 指南、语义合同与当前部署模板一致，保留最近 v1.2 现场部署的版本差异说明，不声称本轮已上线。
- 离线协议 / schema 校验覆盖所有请求示例；原 README 与 Provider 文档已有入口链接。

### UGVBIZ-012：回归与关闭

- 本地 UGV、真实 HTTP/gRPC/PostgreSQL、GOWM、manifest/contract、静态和冻结协议检查记录于 [VALIDATION](VALIDATION.md)。已有 V-NAV / V-EDIT 功能由当前导航/调整套件验证；不重复现场运动或侦察。
- 最终 Runtime / Provider 扩展回归为 76 文件、634 项 PASS；25 项 GOWM 专用用例通过分开的对应数据库门槛。`state/PROGRESS.json` 已写入全部 DONE 与完成标记，证据文件存在性及源码哈希经过核对。
- 没有发送攻击命令；保持发射禁用。无待实施的设备端、身份系统或新业务表改动。

## ACCEPTANCE A–F 对照

| 验收项                                                                                  | 证明位置                                                                   |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| A：development 无凭据查询、业务答复、Intervention、取消、暂停/恢复，业务守卫保留        | UGVBIZ-002 / 003；公开 HTTP + PostgreSQL 用例                              |
| B：live 默认、无 simulationId、显式 simulation、live planner                            | UGVBIZ-004 / 005；配置与公开导航用例                                       |
| C：strict 优先、唯一当前执行推断、fresh/non-retained/post-execution                     | UGVBIZ-006；关联合同与 Provider 矩阵                                       |
| D：发现 → lock → 观测确认 → Input → 匿名答复 → 释放后等恢复                             | UGVBIZ-007；V-OBS / V-INPUT                                                |
| E：至少五类语义、保留 native、未知不猜测、同步与业务共用投影                            | UGVBIZ-008 / 009 / 010；语义合同与一致性测试                               |
| F：未新增 SDK、Session 表/服务、recon.adjust_area、RBAC、上游修改、武器启用或大版本协议 | 代码差异审阅、无 migration / proto / frozen contract 改动、fire=false 回归 |

## 交付边界

当前成果是本地工作区实现与验收材料。没有新增提交、推送、GitHub hosted CI 运行、发布包或现场部署。旧 v1.2 现场验收不被改写。本 Goal 不要求新增这些交付步骤；后续部署需使用本轮源码重新构建，并保留发射禁用配置。
