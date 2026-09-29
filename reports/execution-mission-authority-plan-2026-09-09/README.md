# SMPP Execution→Mission 权威事实缺失：调查与修复方案

状态：只读调查及方案；未实施、未部署、未发起设备动作。发射保持禁用。本次与后续验收限定非武器导航。旧 Benchmark Run 的失败与清理结果不变。

## 1. 已确认根因与边界

现场 Runtime/Adapter 使用镜像来源 `c3599914785913ea107ac5394676537f7542a635-worktree-17d17b081c11`。这是 SMPP 服务身份；不要与外部 SDAR Runtime sourceHash `81e64ef90f96e97424c6f7ddf711dd5e9db1907fe20a16b74b00ba6b693d0446` 混淆。

直接原因是发布与接收配置不对称：Adapter `PROVIDER_TELEMETRY_ENABLED=true`、endpoint=`runtime:7002`；SMPP Runtime `PROVIDER_TELEMETRY_INGRESS_ENABLED=false`。现场 Docker DNS 解析成功，而无业务载荷 TCP 探测返回 ECONNREFUSED。Runtime 容器在本轮导航前已启动，环境变量为容器配置，不是从 Benchmark 推断。

10:51–10:55 UTC 的 Adapter 安全筛选日志中，有 4220 条 `PROVIDER_TELEMETRY_TRANSPORT_FAILED` 和 3399 条 `PROVIDER_TELEMETRY_RETRY_EXHAUSTED` 日志。这是整个时间窗口的日志条数，不是该 Task 的独立事件数，也不能用其重建事件。

持久化链条并未全断：精确 Task 的两条 PRIMARY/FOLLOWUP 回执均 ACCEPTED，`nativeMissionId=41987`；GOWM 两条 Execution→Mission 链接均 LINKED，指向同一 Mission instance。SMPP `provider_ops_delivery` 仅有已交付的 task.lifecycle 24 条、recovery.lifecycle 23 条、scheduler.decision 11 条，与下游 58 条事实相符；没有 provider.execution.progress。故本次已定位到 Adapter→SMPP Runtime 接收之前的传输断点，没有证据支持把直接原因归咎于 ClickHouse 丢记录或 Task ID 不匹配。

存在两个独立的可靠性缺陷：

1. `apps/runtime/src/runtime.ts:217` 在 ingress 关闭时把 dependency 标为 ready，无法证明预期的权威事实通路可用；对应部署模板也默认关闭 ingress。
2. `packages/vehicle-provider-core/src/telemetry.ts` 只有进程内队列，默认最多 4 次尝试，耗尽即移除；故仅开启接收器无法恢复已丢事件，也不满足断网/重启时权威事实可靠交付。

现有 `packages/provider-telemetry/src/ingress.ts` 已有 `captureMissionRelationFact`，但只在接收到 Mission evidence 后运行。GOWM 回执关系落库不会自动触发它。物理证据在 Adapter 的执行 revision 变化时发送，且目前发生在 `putExecution` 之前；需要修正持久化与事件发布顺序。

## 2. 精确证据身份

| 层级                                         | 身份                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Benchmark Run                                | run_6deb108dbcdced5fb8706d14c3e8c4bf747d45c112a786f3972f7c6914dcbec2 |
| 外部 SDAR Runtime Task                       | cc2d0ac7-d22e-463a-9a0e-ee8fc8275ffe                                 |
| invocation                                   | mcp-invocation-7e8fb44d-5067-45ab-8783-353d55ea0cbc                  |
| SMPP Provider/MCP Task（本轮内部 task 相同） | a4181f8e-a9da-4490-bf56-72c2f9cc1514                                 |
| Execution                                    | vehicle:ugv:chassis:30beea1a-52a8-41b6-9f67-7c691bf6daaf             |
| GOWM Mission instance                        | deaeada3-bcf0-43ae-922c-0960006720b4                                 |
| 设备回执中的 native Mission ID               | 41987                                                                |
| PRIMARY resultHash                           | fc0f207a1871b365a5aa548cd2aa6a7d976516d790dfa4c24efd2db693f65101     |
| FOLLOWUP resultHash                          | c6e113cc12e354bb05c4afa0d09a237d25ad39adf6fde49b67ed86b1d5c847db     |

五项权威范围必须同时固定：tenantId=`tenant-local`、projectId=`smpp-development`、environment=`development`、smppSourceId=`smpp.sz-gowm.ugv`、deploymentId=`smpp-sz-gowm`。另绑定 providerId=`isr.vehicle.ugv.ugv`、resourceId=`vehicle:ugv` 和 GOWM device/binding/service scope；设备号、MCP Task、外部 SDAR Task、GOWM Mission UUID 均不可互相替代。

当前原始查询契约 selection=`provider_observed_at_then_source_record_id_scoped_v2`、convergence=`selected_fact_dependency_join_scoped_v3`。结果为一个 Task→Execution、Mission state=null、Execution→Mission 数量 0；该结果应继续阻断。

## 3. 可实施修改

### A. 配置与运行可观测性（SMPP 负责）

- 在 sz-gowm 联合部署配置中显式开启 Runtime ingress，并与 Adapter 的 enabled、endpoint、TLS 配置成对检查。保留 `UGV_FIRE_ENABLED=false`。通用产品默认值是否开启应独立评审，不以现场需求强制所有安装模式开启。
- 修改 `.env.gowm.example`、`package.mjs` 的站点预检及 `tests/unit/development-package.test.ts`：拒绝 Adapter 发事件但目标 ingress 关闭的组合；校验网络、端口、身份和 TLS 对称性。
- 区分“未配置/disabled”和“已监听/ready”；业务 `/health/ready` 与证据通路 readiness 分开报告。新 Benchmark 的准入还要验证最近一次正式通路验收，而非把端口存活当成交付成功。禁止用伪造 Mission 事件做健康探针。
- 安全暴露队列长度、最老积压年龄、accepted/rejected/retried/dead-letter 与稳定错误码。传输拒绝需保留 gRPC status 类别，避免仅泛化为 TRANSPORT_FAILED。

### B. 权威来源、事务与事件（SMPP 主责，GOWM 审核存储契约）

- 复用 `advanceMutationJournal` → `recordMissionReceipt` 的同一事务，保存回执证据与待发布意图。新增 SMPP 自有持久事件表/游标，由 GOWM 正式业务域迁移安装；不写外部事实库。不允许回执提交成功而权威发布意图丢失。
- Mission 关联依据必须是受校验的命令回执、执行身份及作用域；需要观测确认时，仅使用与该回执 Mission 和后派发观察基线一致的持久证据。车上当前 mission 状态不能单独确立关系。现存 GOWM 链接是来源证据，不能让脚本从链接直接拼装 ClickHouse 行。
- 把任务状态更新和对应 evidence/事件意图原子提交，再由 worker 发送。关键 Mission/执行事实不使用会丢弃的内存队列；高频非关键指标可继续有限缓存。Task 尚未发布时，保持 pending，待 admission/external execution 的正式关联完成后发送，不猜测父 Task。
- 统一 Runtime ingress 对权威关系的 reducer，避免“回执路径”和“物理事件路径”各自发布互相矛盾的 current state。`exact` 表示该执行的唯一、可追溯 Mission；没有足够身份为 `unresolved`；同一预期单 Mission 执行有冲突证据为 `conflict`。多个正常步骤返回同一 native ID 不算冲突。多 Mission 业务另作有版本的集合契约，不能选择一个冒充唯一。
- 最新观测与历史执行关系的有效性分开定义；不因其他任务后来的设备状态，把已经确认的历史执行随意改成另一个 Mission。兼容现有“较新 unresolved 阻断历史 exact”的防陈旧规则；若需要调整，必须与 Telemetry 一起版本化并添加负例，不能直接删除阻断规则。

### C. 对外事实契约和可靠交付

保留并验证 `recordType=provider.execution.progress`、`eventType=smpp.mission.relation`、attributes `sdar.fact.kind=mission_relation`、`sdar.mission.relation_status`、`sdar.device.mission_id`、`sdar.mission.source_record_refs`，以及 payload 的 relationStatus/deviceMissionId/sourceRecordRefs/observedAt；两处身份、状态、引用必须一致。exact 必须有非空设备 Mission ID 及来源引用；unresolved/conflict 不发布假唯一关系。

- Provider event ID、source record ID、canonical hash、发生时间、观察时间、因果引用在首次持久化时冻结；重试不生成新 ID/hash，不用发送时间覆盖 observedAt。
- 来源引用必须能追到正式回执/匹配观测事实，记录原始 resultHash 与因果关系；不要把 resultHash 直接充当 ProviderOps recordHash。若增加 receipt 来源类型或 sourceRecordHashes，需与 Telemetry 验证器共同发布版本，不能绕过 allowlist。
- 范围由受信部署配置和身份映射提供。归一化后的 entity refs 中必须各有一个正确 scoped Task、Execution URN；Mission URN、origin SDAR Task/invocation 与 source provenance 保留，禁止跨 deployment/project 拼接。
- Runtime ingress 在同一事务保存源事件和关联事实后才 ACK；同 ID 同 hash 为 duplicate，同 ID 不同 hash 为冲突并隔离。检查并修正当前接收时动态 emittedAt 等字段对重放 hash 的影响。
- 发布器采用持久 claim/lease、退避、可恢复 dead-letter；网络断开和 ACK 丢失只重送同一事件。接收后到 `provider_ops_delivery` 再由 `DurableProviderOpsPublisher` 导出；逐段确认 record/hash，不能把本地 DELIVERED 等同 Current Authority 已收敛。
- 重启恢复只重放已提交意图，不重新执行导航。响应丢失保持 UNCERTAIN，正式恢复拿到可靠身份后发布更高 revision 的解析结果；不能从“到达了”反推设备回执成功。

## 4. 兼容迁移与外部交付

采用增量 SMPP 业务域迁移：新事件表、作用域唯一键、claim/lease/ACK/error 字段和必要最小权限。不删 GOWM 业务表/卷、不重建现场库、不改业务密码。先装兼容迁移，再部署消费者、生产者；回滚应用保留 pending 事件，不能删表止错。

本次默认不回填历史缺失事件。若以后授权恢复历史，只能由版本化服务读取真实持久回执，经正常事件出口发布带原始时序及恢复标记的事实，严格查验来源完整性；仍不得重写旧 Run。原始观察已丢时如实标明不可恢复。

| 负责方         | 交付责任                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SMPP           | 修复 ingress 配置/就绪语义；持久事件与 reducer；幂等恢复；出包和逐段验收证据                                                                                 |
| GOWM           | 审核并交付 SMPP 自有域增量迁移、作用域约束及最小授权；保留原生 Mission 身份模型                                                                              |
| SMPP Telemetry | 验证既有 scoped_v2/v3 接受新事件并收敛；若采用 receipt 类型或新增因果字段，必须提供验证器/归一化映射/重放迁移与联合契约测试，不能只交一个关系补丁            |
| SDAR Telemetry | 在 `deploy/sz-gowm/deploy.py` 的 reader grant 清单和站点预检中固化 `sdar_core.v_smpp_provider_task_timeline` 精确 SELECT；当前现场补授是独立增量，旧包未包含 |
| Benchmark      | 固定新上游身份，保持 P10_MISSION_AUTHORITY_MISSING 与跨范围阻断，发起新 Run 并保留旧失败结果                                                                 |

即使最小配置修复理论上可复用现有 Telemetry 协议，仍需要 Telemetry 负责人提供真实通路验收；不能由 SMPP 单方宣告其映射已正确。完整可靠性方案若扩展来源证据契约则必须联合交付。当前没有请求其他任务修改代码或现场。

## 5. 验证与部署顺序

1. 冻结本次只读证据、当前镜像/配置及两套 Telemetry 版本；统一 receipt 与 observation 的权威语义、五项范围和权限责任。确认实施窗口及新的非武器导航验收授权。
2. 在隔离 PostgreSQL 跑回执/事件原子性、RLS/作用域和并发测试；在正式协议 fixture 中验证重复、乱序、hash 冲突、缺引用、较新 unresolved、跨五项范围、错误 Task/Execution/URN、缺 observedAt、设备 ID 重用及 boot/session 不明等负例。
3. 故障测试覆盖：回执前/后崩溃、事务提交后发送前崩溃、入口宕机超出旧 4 次重试窗口、ACK 丢失、publisher lease 接管、Telemetry 暂停/重复导入、源事实与派生关系乱序。恢复后单一逻辑关联，且设备命令调用数不增加。
4. 备份与增量迁移 → 如有需要先部署兼容 Telemetry → 固化 SDAR reader 权限 → 部署 SMPP 并开启 ingress → 验证无丢失的正式发送/接收/导出通路。保持发射禁用；不执行临时业务控制探针。
5. 用新的授权真实导航 Run，从 consumed 确认到 Provider 回执、原生 Mission、持久事件、outbox、external_provider_fact、Current Authority 顺序核验。要求同五项范围下 taskExecution=1、missionAuthorityState=exact、executionMission=1，所选 record/hash、entity refs、来源引用与因果身份一致且可追溯。
6. 缺证据、跨范围及冲突负例仍失败；超时应报哪一段缺口，而非放宽成功条件。新 Run 才能获得新结果；旧 run_6deb… 保持失败。物理到达验证独立于 Provider 权威证据，两者均满足才能通过完整验收。

当前无需再猜测直接根因；尚需确认的是实施授权/窗口、Telemetry 新来源类型是否需要版本升级，以及 GOWM 迁移与 SDAR 精确权限的发布归属。仅打开 ingress 是必要的第一步，不是可靠性修复完成的证明。

## 6. 代码与现有证据入口

- SMPP：`apps/runtime/src/runtime.ts`；`apps/ugv-provider-adapter/src/runtime.ts` 的 identityTelemetry、#emitPhysicalEvidence；`packages/vehicle-provider-core/src/telemetry.ts`；`packages/provider-telemetry/src/ingress.ts`；`packages/provider-adapter-kit/src/postgres-store.ts`；`packages/gowm-shared-storage-adapter/src/mission-links.ts`；`packages/persistence-postgres/src/provider-ops-delivery.ts`；`packages/task-engine/src/durable-provider-ops-publisher.ts`。
- Telemetry：`smpp-telemetry-platform/telemetry-processor/src/packages/validation/smpp-runtime-semantics.ts`、normalization/smpp-provider-ops-v1.ts；`telemetry-dashboard/query-api/src/current-authority.ts`。
- Benchmark 原始证据：`/home/zhouwen/web-download/sdar-benchmark-server/reports/native-runtime-resume-20260909/` 内 README、far-current-authority-scoped.json、far-mission-facts-audit.json、far-provider-timeline-after-grant.json、far-provider-closure-handoff.json、far-independent-physical.json、telemetry-timeline-grant.json。物理位置不作为权威关系来源。
