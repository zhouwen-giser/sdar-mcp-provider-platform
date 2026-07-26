**SDAR MCP Provider Platform**

**开发计划与工作量评估**

基于离线 Runtime + UGV/NPC/HA Provider 集合的增量平台建设计划

| **项目**     | **内容**                                                              |
|--------------|-----------------------------------------------------------------------|
| 文档版本     | V1.0                                                                  |
| 总体设计基线 | SDAR MCP Provider Platform 总体设计说明书 V1.0                        |
| 实现基线     | sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip |
| 评估口径     | 1 人月 = 20 个有效工程人日                                            |
| 建议版本范围 | 单节点 PM2、供应商自管 Adapter、配置中心优先                          |
| 日期         | 2026-07-26                                                            |

**推荐 V0.1：约 29 人月，6-7.5 个月，6-7 人核心团队**

# 1 执行摘要

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>结论</strong></p>
<p>在复用现有 55,130 行 TypeScript/TSX、8 个应用、13 个共享包、125 个测试文件和冻结协议验证资产的前提下，推荐 V0.1 的纯工程期望工作量约 25.1 人月；计入 15% 的集成与环境风险缓冲后约 28.9 人月。建议 6-7 人团队按 15 个双周 Sprint、约 6-7.5 个月完成。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

本项目不是重写 MCP Tasks Runtime，而是在离线包母体工程上增量增加 PMS 控制面、共享配置契约、数据库自动准备、PM2 Runtime Adapter、Provider Package Registry、Catalog/Registry 和管理后台。现有 Runtime 状态机、协议、Migration 和 Provider 验证资产应视为受保护基线。

当前推荐范围默认“一个逻辑 Provider 一个 Runtime Deployment、每个 Provider 先使用一个 Runtime 进程”，平台可以同时管理多个 Provider Runtime。若 V0.1 就要求同一 Provider 多副本、稳定 Gateway 和跨节点 PM2，对工作量和风险会有明显增加。

| **方案**  | **范围**                                                                                                                        | **工作量** | **日历周期** | **建议团队** |
|-----------|---------------------------------------------------------------------------------------------------------------------------------|------------|--------------|--------------|
| MVP       | 配置中心优先；单节点；每 Provider 单 Runtime；供应商自管 Adapter；最小 Console；不做完整 Registry 历史                          | 15-18 人月 | 4.5-5.5 个月 | 4-5 人       |
| 推荐 V0.1 | 总体设计中的完整单节点平台；配置闭环、建库迁移、PM2、多 Provider Runtime、Package Registry、Catalog/Registry、Console、完整 E2E | 约 29 人月 | 6-7.5 个月   | 6-7 人       |
| 增强版    | 在推荐 V0.1 上增加同 Provider 多副本稳定 Gateway、多节点 PM2、Vault、平台托管 Adapter、完整 ClickHouse Collector 管理           | 37-41 人月 | 9-11 个月    | 7-9 人       |

## 1.1 建议选择

- 以“推荐 V0.1”为正式计划：完整单节点平台能力，不建设 Kubernetes 或跨主机调度。

- 第一里程碑优先打通配置闭环：PMS 发布 OTLP/遥测开关，Runtime Pull/Apply/Ack/LKG。

- 第二里程碑打通自动运行闭环：创建 Runtime DB → Migration → PM2 启动 → health/ready → Catalog。

- 同一 Provider 多副本稳定入口、Vault、多节点 PM2、平台托管供应商 Adapter列为增强项，不放入基础承诺。

# 2 评估基线与假设

## 2.1 代码基线

| **指标**       | **基线值**                 | **评估影响**                                   |
|----------------|----------------------------|------------------------------------------------|
| 项目版本       | 2.0.0-rc.1                 | 已有成熟 Runtime，降低协议与任务引擎开发量     |
| TypeScript/TSX | 280 个文件，约 55,130 行   | 迁移与回归成本不可忽略                         |
| 测试文件       | 125                        | 可复用，但数据库和环境门禁需要重跑             |
| 应用           | 8                          | 含 Runtime、UGV、NPC、HA 及 Mock 资产          |
| 共享包         | 13                         | 协议、任务引擎、持久化、遥测等应保持边界       |
| Migration SQL  | 26                         | 001-023 Runtime 与 024/025 Provider 需要先拆分 |
| 冻结协议       | Runtime 74/74 作为回归基线 | 任何平台改造不得弱化现有门禁                   |

## 2.2 工作量估算假设

- 离线包为唯一母体工程；现有 Runtime、UGV、NPC、HA 代码整体复用，不进行大规模核心重写。

- V0.1 单节点部署，PM2 Fork Mode；同一 Provider 默认 desiredReplicas=1，但可同时启动多个不同 Provider Runtime。

- Provider Adapter 生产环境默认 vendor_managed；平台只管理标准 Runtime 和 Runtime Database。

- PostgreSQL 使用共享 Cluster、每个逻辑 Provider 独立 Runtime Database；PMS Database 独立。

- Secret 首版按 SecretRef + 本地 0600 文件实现；不含企业 Vault 审批和基础设施建设。

- ClickHouse 通过 Collector 共享接入；Runtime 不直接连接 ClickHouse。

- 现有 PostgreSQL、PM2、Node 22、pnpm 11 环境可在项目早期提供。

- 真实设备资格验证、供应商网络等待和外部审批不计入纯工程人日。

## 2.3 估算方法

阶段工作量采用三点估算：乐观 O、最可能 M、悲观 P，并使用 PERT 期望值 (O + 4M + P) / 6。最终人月按 20 个有效工程人日折算，再增加 15% 的集成、环境、返工和跨模块风险缓冲。

# 3 总体开发路线

计划分为 M0-M10 共 11 个阶段。配置中心和 Runtime Config Client 是首要关键路径；Provider Package 和 Web Console 可以在 PMS 核心稳定后并行推进。

| **阶段** | **工作包**                                      | **计划窗口** | **期望人日** | **主要交付物**                                          | **退出门禁**                                   |
|----------|-------------------------------------------------|--------------|--------------|---------------------------------------------------------|------------------------------------------------|
| M0       | 离线基线导入与仓库升级                          | W1-W2        | 20           | 来源锁、初始 Git 基线、平台命名与保护清单               | 原 Runtime 静态门禁和协议锁不回退              |
| M1       | Migration 集合拆分与回归                        | W2-W4        | 26           | runtime/providers/pms 三套 Migration Set 与 Runner      | 空库、升级路径和目录隔离测试通过               |
| M2       | 共享配置契约                                    | W3-W6        | 35           | 配置定义、JSON Schema、Apply Mode、Secret 路径          | 现有 Runtime/Provider 配置行为回归一致         |
| M3       | PMS 核心、领域与持久化                          | W5-W10       | 61           | PMS API/Worker、控制面数据库、审计、Job Lease           | Provider/Deployment/Config 基础 API 与迁移通过 |
| M4       | 配置中心与 Runtime Config Client                | W8-W15       | 71           | Draft/Publish/Rollback、Pull/Watch/Ack、LKG、热更新     | OTEL 开关发布到 Runtime 并成功 Ack             |
| M5       | 数据库 Profile、Provisioner 与 Migration Runner | W12-W17      | 45           | 按 Provider 创建 DB/Role、SecretRef、版本一致 Migration | 自动建库、迁移、权限和失败恢复验证             |
| M6       | PM2 Runtime Adapter 与 Deployment 对账          | W16-W21      | 51           | PM2 start/stop/restart/delete、RuntimeProcess、健康对账 | PMS 可自动启动多个独立 Runtime 进程            |
| M7       | Provider Package Registry 与内置包整理          | W10-W14      | 31           | UGV/NPC/HA 包描述、配置、Migration 和资格状态           | 三个内置包 Self-check 和展示通过               |
| M8       | Catalog、Registry Snapshot 与 SDAR 接入         | W21-W25      | 46           | Discover、Catalog、Registry Revision/ETag/Watch         | 真实 Runtime Catalog 和 SDAR Registry 投影通过 |
| M9       | PMS Web Console、审计与运维视图                 | W12-W23      | 51           | Provider、配置、数据库、Runtime、Catalog、审计页面      | 核心操作非占位且具备错误/状态呈现              |
| M10      | 系统 E2E、安全加固、文档与发布                  | W24-W30      | 66           | 完整 E2E、故障隔离、安全、运行手册和发布报告            | verify:platform 全绿并形成 V0.1 发布候选       |

## 3.1 关键里程碑

| **里程碑**           | **目标周** | **可验收结果**                                    |
|----------------------|------------|---------------------------------------------------|
| K0 基线锁定          | W2         | 离线包来源、仓库初始提交和受保护资产清单完成      |
| K1 Migration 解耦    | W4         | Runtime、Provider、PMS Migration Set 物理隔离     |
| K2 配置契约冻结      | W6         | Runtime/PMS 使用同一配置定义和 Apply Mode         |
| K3 配置闭环          | W15        | OTLP/遥测开关 Publish→Pull→Apply→Ack→LKG          |
| K4 自动 Runtime 启动 | W21        | 自动建库、迁移、PM2 启动、ready 和状态对账        |
| K5 Catalog/Registry  | W25        | 真实 Runtime Discover、Catalog、Registry Snapshot |
| K6 V0.1 RC           | W30        | 系统 E2E、安全、故障隔离、文档和发布候选          |

## 3.2 关键路径

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>关键路径</strong></p>
<p>M0 基线 → M1 Migration 拆分 → M2 配置契约 → M3 PMS 核心 → M4 配置中心/Runtime Client → M5 数据库准备 → M6 PM2 对账 → M8 Catalog/Registry → M10 系统 E2E。M7 Provider Package 与 M9 Console 可并行，但不得阻塞配置和自动启动主链。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# 4 分阶段开发计划

## 4.1 M0 离线基线导入与仓库升级

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W1-W2，2 周                                        |
| 工作量   | 乐观 15 / 最可能 20 / 悲观 28 人日；PERT 20.5 人日 |
| 主要交付 | 来源锁、初始 Git 基线、平台命名与保护清单          |
| 退出门禁 | 原 Runtime 静态门禁和协议锁不回退                  |

- 校验 ZIP SHA-256、WORK_DELIVERY_MANIFEST、SHA256SUMS 和协议锁。

- 创建新 Git 仓库与 Baseline Commit，保留原始路径。

- 建立受保护路径、基线报告、工具链和环境阻断清单。

- 运行无需 PostgreSQL 的 format/lint/typecheck/build/protocol 静态门禁。

## 4.2 M1 Migration 集合拆分与回归

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W2-W4，3 周                                        |
| 工作量   | 乐观 18 / 最可能 25 / 悲观 35 人日；PERT 25.5 人日 |
| 主要交付 | runtime/providers/pms 三套 Migration Set 与 Runner |
| 退出门禁 | 空库、升级路径和目录隔离测试通过                   |

- 将原 001-023 移入 migrations/runtime，024/025 分别移入 provider 目录。

- 拆分 migrateRuntimeDatabase、migrateProviderDatabase、migratePmsDatabase。

- 生成旧路径到新路径映射和 SQL 完整性报告。

- 补齐空库、重复执行、升级路径、并发 Advisory Lock 测试。

## 4.3 M2 共享配置契约

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W3-W6，4 周                                        |
| 工作量   | 乐观 25 / 最可能 35 / 悲观 45 人日；PERT 35.0 人日 |
| 主要交付 | 配置定义、JSON Schema、Apply Mode、Secret 路径     |
| 退出门禁 | 现有 Runtime/Provider 配置行为回归一致             |

- 从 Runtime、UGV、NPC、HA Zod 配置抽取共享 Configuration Definition。

- 定义 targetType、继承层级、Apply Mode、Secret Paths、生产约束。

- 生成 JSON Schema、Runtime Validator 和 PMS 表单元数据。

- 建立字节级/行为级默认值回归测试。

## 4.4 M3 PMS 核心、领域与持久化

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W5-W10，6 周                                       |
| 工作量   | 乐观 45 / 最可能 60 / 悲观 80 人日；PERT 60.8 人日 |
| 主要交付 | PMS API/Worker、控制面数据库、审计、Job Lease      |
| 退出门禁 | Provider/Deployment/Config 基础 API 与迁移通过     |

- 实现 pms-domain、pms-persistence-postgres、pms-api、pms-worker 骨架。

- 实现 Provider、RuntimeDeployment、RuntimeProcess、DatabaseProfile、ConfigRevision、Audit、Job Lease。

- 建立版本化 OpenAPI、认证/角色、错误模型和短事务边界。

- 提供可运行的 PMS Database Migration 与 CI 门禁。

## 4.5 M4 配置中心与 Runtime Config Client

| **项目** | **内容**                                            |
|----------|-----------------------------------------------------|
| 计划窗口 | W8-W15，8 周                                        |
| 工作量   | 乐观 50 / 最可能 70 / 悲观 95 人日；PERT 70.8 人日  |
| 主要交付 | Draft/Publish/Rollback、Pull/Watch/Ack、LKG、热更新 |
| 退出门禁 | OTEL 开关发布到 Runtime 并成功 Ack                  |

- 实现 Config Draft/Validate/Publish/Rollback/History/Diff/Watch。

- 实现 Runtime Config Client 的 ETag/304、Staging、Atomic Swap、LKG。

- 实现 applied/rejected/restart_required/stale Ack。

- 先落地 OTLP 开关、日志级别、Sampling、部分 Poll Interval 热更新。

- 确保 PMS 不可用或新配置损坏时 Runtime 继续使用 LKG。

## 4.6 M5 数据库 Profile、Provisioner 与 Migration Runner

| **项目** | **内容**                                                |
|----------|---------------------------------------------------------|
| 计划窗口 | W12-W17，6 周                                           |
| 工作量   | 乐观 30 / 最可能 45 / 悲观 60 人日；PERT 45.0 人日      |
| 主要交付 | 按 Provider 创建 DB/Role、SecretRef、版本一致 Migration |
| 退出门禁 | 自动建库、迁移、权限和失败恢复验证                      |

- 实现 PostgreSQL Cluster/Database Profile、SecretRef 和权限模型。

- 实现创建 Database/Role、最小授权和连接测试。

- 按 runtimeVersion 调用 Runtime 自带 Migration Runner。

- 实现 Migration 状态、重试、错误证据和不自动清库策略。

- 实现数据库变化 restart_required，不进行隐式 Task Authority 切换。

## 4.7 M6 PM2 Runtime Adapter 与 Deployment 对账

| **项目** | **内容**                                                |
|----------|---------------------------------------------------------|
| 计划窗口 | W16-W21，6 周                                           |
| 工作量   | 乐观 35 / 最可能 50 / 悲观 70 人日；PERT 50.8 人日      |
| 主要交付 | PM2 start/stop/restart/delete、RuntimeProcess、健康对账 |
| 退出门禁 | PMS 可自动启动多个独立 Runtime 进程                     |

- 实现 Pm2ProcessManager 和 RuntimeInfrastructureAdapter。

- 生成受控 Bootstrap Config、Secret 文件和 PM2 Fork 规格。

- 实现 start/stop/restart/delete/inspect/reconcile。

- 区分 PM2 online、health/live 和 health/ready。

- 支持多个不同 Provider Runtime 自动启动、端口分配和崩溃重启。

## 4.8 M7 Provider Package Registry 与内置包整理

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W10-W14，5 周                                      |
| 工作量   | 乐观 20 / 最可能 30 / 悲观 45 人日；PERT 30.8 人日 |
| 主要交付 | UGV/NPC/HA 包描述、配置、Migration 和资格状态      |
| 退出门禁 | 三个内置包 Self-check 和展示通过                   |

- 建立 provider-packages/ugv、npc-tank、home-assistant-climate。

- 描述入口、配置 Schema、Migration Set、兼容 Runtime 和资格状态。

- 区分 bundled Provider 与 Mock Fixture。

- 实现 Package Schema、Self-check 和 PMS 列表/详情 API。

## 4.9 M8 Catalog、Registry Snapshot 与 SDAR 接入

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W21-W25，5 周                                      |
| 工作量   | 乐观 30 / 最可能 45 / 悲观 65 人日；PERT 45.8 人日 |
| 主要交付 | Discover、Catalog、Registry Revision/ETag/Watch    |
| 退出门禁 | 真实 Runtime Catalog 和 SDAR Registry 投影通过     |

- Runtime ready 后执行 server/discover + tools/list。

- 实现不可变 Catalog Snapshot、Checksum、Drift 和 Operation 投影。

- 实现 Registry Snapshot、Revision、ETag/304、History/Diff/Watch。

- 输出 SDAR 可消费的 providerId/serverId、effectiveEndpoint 和 Tool Projection。

- 保证 Snapshot 不包含凭据、Task 数据和 PM2 内部信息。

## 4.10 M9 PMS Web Console、审计与运维视图

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W12-W23，12 周（并行）                             |
| 工作量   | 乐观 35 / 最可能 50 / 悲观 70 人日；PERT 50.8 人日 |
| 主要交付 | Provider、配置、数据库、Runtime、Catalog、审计页面 |
| 退出门禁 | 核心操作非占位且具备错误/状态呈现                  |

- 实现 Provider、Runtime、配置、数据库 Profile、Package、Catalog、Registry、Audit 页面。

- 实现 Draft 编辑、Publish/Rollback、Ack 状态和 restart_required 展示。

- 实现 RuntimeProcess 状态、日志链接、错误证据和二次确认。

- 覆盖分页、过滤、加载、空态和错误态。

## 4.11 M10 系统 E2E、安全加固、文档与发布

| **项目** | **内容**                                           |
|----------|----------------------------------------------------|
| 计划窗口 | W24-W30，7 周                                      |
| 工作量   | 乐观 45 / 最可能 65 / 悲观 90 人日；PERT 65.8 人日 |
| 主要交付 | 完整 E2E、故障隔离、安全、运行手册和发布报告       |
| 退出门禁 | verify:platform 全绿并形成 V0.1 发布候选           |

- 搭建 PMS + PostgreSQL + PM2 + Runtime + Mock/内置 Provider + SDAR 的 E2E Harness。

- 验证配置闭环、建库迁移、自动启动、Catalog/Registry 和 SDAR 调用。

- 覆盖 PMS 停机、Runtime 崩溃、DB/Adapter 不可用、配置损坏、Migration 失败。

- 完成 Secret/权限/SSRF/日志脱敏、安全和 SBOM 门禁。

- 形成部署手册、运维手册、迁移报告和 V0.1 发布报告。

# 5 工作量评估

## 5.1 按阶段估算

| **阶段** | **工作包**                                      | **O 人日** | **M 人日** | **P 人日** | **PERT 人日** | **人月** |
|----------|-------------------------------------------------|------------|------------|------------|---------------|----------|
| M0       | 离线基线导入与仓库升级                          | 15         | 20         | 28         | 20.5          | 1.0      |
| M1       | Migration 集合拆分与回归                        | 18         | 25         | 35         | 25.5          | 1.3      |
| M2       | 共享配置契约                                    | 25         | 35         | 45         | 35.0          | 1.8      |
| M3       | PMS 核心、领域与持久化                          | 45         | 60         | 80         | 60.8          | 3.0      |
| M4       | 配置中心与 Runtime Config Client                | 50         | 70         | 95         | 70.8          | 3.5      |
| M5       | 数据库 Profile、Provisioner 与 Migration Runner | 30         | 45         | 60         | 45.0          | 2.2      |
| M6       | PM2 Runtime Adapter 与 Deployment 对账          | 35         | 50         | 70         | 50.8          | 2.5      |
| M7       | Provider Package Registry 与内置包整理          | 20         | 30         | 45         | 30.8          | 1.5      |
| M8       | Catalog、Registry Snapshot 与 SDAR 接入         | 30         | 45         | 65         | 45.8          | 2.3      |
| M9       | PMS Web Console、审计与运维视图                 | 35         | 50         | 70         | 50.8          | 2.5      |
| M10      | 系统 E2E、安全加固、文档与发布                  | 45         | 65         | 90         | 65.8          | 3.3      |
| 合计     |                                                 | 348        | 495        | 683        | 501.8         | 25.1     |
| 含缓冲   | 15% 风险缓冲                                    |            |            |            | 577.1         | 28.9     |

## 5.2 按角色估算

| **角色**          | **期望人日** | **约合人月** | **主要职责**                                         |
|-------------------|--------------|--------------|------------------------------------------------------|
| 技术负责人/架构   | 45           | 2.2          | 架构决策、基线保护、跨模块评审、关键故障收口         |
| PMS 后端/平台开发 | 150          | 7.5          | 领域、API、Worker、配置中心、Catalog/Registry        |
| Runtime/协议开发  | 100          | 5.0          | 共享配置契约、Runtime Client、热更新、回归保护       |
| 数据库与运行工程  | 65           | 3.2          | Migration 拆分、Provisioner、PM2 Adapter、部署与安全 |
| 前端开发          | 55           | 2.8          | PMS Console、配置表单、部署/进程/审计视图            |
| 测试与质量自动化  | 87           | 4.3          | 数据库/PM2/配置/E2E/故障/安全门禁                    |

角色分解合计 502 人日，与阶段 PERT 期望 501.8 人日基本一致。角色工作量表示能力需求，不表示必须由六个完全独立岗位承担；小团队可由技术负责人、后端和测试人员兼任部分职责。

## 5.3 日历周期推算

| **团队模式** | **有效投入**                        | **预计周期** | **判断**                               |
|--------------|-------------------------------------|--------------|----------------------------------------|
| 精简团队     | 4 人，其中前端/测试兼职             | 9-11 个月    | 可做，但关键模块串行明显，风险高       |
| 推荐团队     | 6-7 人，DevOps/DB 可 0.5-1 FTE 共享 | 6-7.5 个月   | 范围、质量和并行度较平衡               |
| 加速团队     | 8-9 人，模块负责人稳定              | 5-6 个月     | 需要严格接口冻结，否则协调成本抵消人力 |

## 5.4 增强项附加工作量

| **增强能力**                                 | **附加工作量**      | **说明**                                             |
|----------------------------------------------|---------------------|------------------------------------------------------|
| 同一 Provider 多 Runtime 副本 + 稳定 Gateway | 30-45 人日          | 涉及稳定入口、Drain、Notification/连接恢复和故障切换 |
| 多节点 PM2 Agent 与跨节点 Placement          | 45-70 人日          | 节点注册、心跳、容量、端口、Secret 分发与故障迁移    |
| Vault/企业 Secret Store 集成                 | 15-25 人日          | 不含企业侧审批与基础设施建设                         |
| 平台托管内置 UGV/NPC/HA Adapter              | 25-40 人日          | 增加 Provider DB、Adapter 生命周期和健康治理         |
| Collector 到 ClickHouse 完整配置与运维       | 25-45 人日          | 包含表模型、批处理、重试和可观测性；Runtime 仍不直连 |
| 每个 Provider 的真实设备资格验证             | 15-30 人日/Provider | 不含供应商、网络、设备和场地等待时间                 |

# 6 团队配置与 Sprint 安排

## 6.1 推荐团队

| **角色**              | **人数/FTE** | **阶段重点**              |
|-----------------------|--------------|---------------------------|
| 技术负责人/架构兼后端 | 1            | 全程；M0-M4、M8、M10 重点 |
| PMS 后端工程师        | 2            | M3-M6、M8                 |
| Runtime/协议工程师    | 1            | M1-M4、M8、M10            |
| 前端工程师            | 1            | M3 接入，M9 主责          |
| 测试/质量自动化       | 1            | M0 建基线，M4-M10 持续    |
| DevOps/数据库工程师   | 0.5-1        | M1、M5、M6、M10           |

## 6.2 双周 Sprint 建议

| **Sprint** | **周期** | **主要目标**                               |
|------------|----------|--------------------------------------------|
| S0         | W1-W2    | 基线锁、仓库导入、环境清单                 |
| S1         | W3-W4    | Migration 拆分、真实 PostgreSQL Harness    |
| S2         | W5-W6    | 共享配置契约与 Schema 生成                 |
| S3         | W7-W8    | PMS Domain/Persistence/API 骨架            |
| S4         | W9-W10   | PMS Config Draft/Publish 与审计            |
| S5         | W11-W12  | Runtime Config Client、Cache、ETag/LKG     |
| S6         | W13-W14  | 热更新/Ack、配置 Console 初版              |
| S7         | W15-W16  | Database Profile 与 Provisioner            |
| S8         | W17-W18  | Migration Runner、Secret 文件与 PM2 基础   |
| S9         | W19-W20  | RuntimeDeployment/Process 对账与健康       |
| S10        | W21-W22  | Provider Package、Catalog Discover         |
| S11        | W23-W24  | Registry Snapshot、SDAR 投影、Console 完善 |
| S12        | W25-W26  | 系统 E2E 主链、PMS/Runtime 故障            |
| S13        | W27-W28  | 安全、性能、容量、部署与运维文档           |
| S14        | W29-W30  | 全量修复循环、发布报告和 RC                |

# 7 依赖、风险与控制措施

| **风险**                        | **影响**                                     | **控制措施**                                           | **工作量影响** |
|---------------------------------|----------------------------------------------|--------------------------------------------------------|----------------|
| Runtime/Provider Migration 混合 | 可能污染 Task DB，是所有自动化建库的前置阻断 | M1 独立完成；SQL 内容锁、路径映射、升级测试            | 已计入         |
| 配置热更新边界不清              | 可能破坏运行状态或形成双 Task Authority      | 每个字段显式 Apply Mode；默认 restart_required         | 已计入         |
| PM2 权限和任意命令风险          | PMS Worker 可能获得宿主机高权限              | 固定入口/cwd/命名空间/环境允许列表；不暴露任意命令 API | 已计入         |
| 真实 PostgreSQL/PM2 环境晚到    | 数据库与进程门禁持续阻断                     | W1 提供环境；CI 使用固定 Harness                       | 可增加 2-4 周  |
| 同 Provider 多副本需求提前进入  | 需要稳定入口、Drain 和 Notification 恢复     | 基础 V0.1 限制单 Provider 单副本，增强项另排           | +30-45 人日    |
| 供应商 Adapter/设备联调不可控   | 系统 E2E 和真实资格延后                      | 核心以 Mock/内置包证明；真实资格单独跟踪               | 不计等待时间   |
| 范围持续扩张                    | 配置、部署、Registry、数据平台同时膨胀       | 以两个优先闭环和 DoD 锁范围                            | 需要变更评审   |

## 7.1 项目级前置条件

1.  在 W1 提供可用的 Node 22、pnpm 11、PostgreSQL 以及 PM2 测试环境。

2.  明确 V0.1 是否限制同一 Provider desiredReplicas=1；本文按限制处理。

3.  明确 Secret 首版采用本地文件 Store；企业 Secret Store 作为后续适配。

4.  提供 SDAR 可联调分支或固定版本，并冻结 Registry Projection 接口。

5.  确认 UGV/NPC/HA 在 V0.1 中仅作为内置 Package 和测试资产，不承诺真实设备资格。

# 8 版本范围与交付边界

## 8.1 推荐 V0.1 必做

- 离线包导入、仓库升级、Migration Set 拆分。

- 共享配置契约、PMS 配置中心、Runtime Pull/Watch/Ack/LKG。

- PostgreSQL Profile、按 Provider 自动建库、Role、SecretRef 和 Runtime Migration。

- PM2 Fork 进程管理、RuntimeDeployment/RuntimeProcess 和健康对账。

- 多个不同 Provider Runtime 自动启动和停止。

- UGV/NPC/HA Provider Package Registry。

- 真实 Runtime Discover、Catalog、Registry Snapshot 和 SDAR 投影。

- PMS Web Console、审计、安全、E2E、故障隔离和运维文档。

## 8.2 V0.1 明确不做

- Kubernetes、Docker 编排和跨主机自动调度。

- 同一 Provider 多副本的稳定 Gateway 和完整 HA；无稳定入口时 desiredReplicas=1。

- PMS 自动管理供应商生产 Adapter。

- Runtime 直接连接 ClickHouse。

- 复杂灰度发布、流量切分、自动数据库迁移切换。

- 真实设备资格和系统级 Interop Certified 的无证据声明。

# 9 验收与 Definition of Done

6.  目标 Monorepo 可在 Node 22、pnpm 11 下安装、构建和执行统一门禁。

7.  现有冻结协议 74/74、UGV/NPC/HA 现有验证资产不回退。

8.  Runtime、UGV、NPC、PMS Migration Set 物理隔离，各 Runner 只读取自身目录。

9.  PMS Config Center 完成 Draft、Publish、Rollback、Watch、Pull、Ack 和 LKG。

10. OTLP/遥测开关可在线应用，Task Engine 不受影响。

11. 数据库配置变化返回 restart_required，不隐式切换 Task Authority。

12. PMS 可按 Provider 创建 Runtime Database、执行 Runtime Migration。

13. PM2 Adapter 可启动、停止、重启和删除多个不同 Provider Runtime。

14. 每个 Runtime 有独立 instanceId、port、PID、日志和 readiness；PM2 online 不替代 ready。

15. UGV/NPC/HA 可作为 Provider Package 加载、展示和验证。

16. Operation Catalog 仅由正式 server/discover + tools/list 提交。

17. Registry Snapshot 不含凭据、Runtime Task 数据和 PM2 内部信息。

18. PMS 停机不停止已运行 Runtime 和已有 Task。

19. 系统 E2E、安全、故障、部署和运维文档通过，形成可审计发布报告。

# 10 管理建议

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>最重要的范围决策</strong></p>
<p>先把“多个 Runtime”定义为多个 Provider 各自一个 Runtime 进程，而不是同一 Provider 立即做多副本。这样能够在不引入 Gateway、连接黏性和复杂 Drain 的情况下，优先解决人工启动、配置分散和数据库准备问题。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

- 以 K3“配置闭环”和 K4“自动 Runtime 启动”作为两个阶段性产品验收点，而不是等到全部 Console 完成才演示。

- M0-M2 期间禁止同时重构 Runtime Task Engine；平台接入必须以回归门禁保护现有代码。

- 每个 Sprint 结束更新范围、证据、失败命令、环境阻断和剩余工作量，不使用模糊“完成百分比”。

- 对真实设备资格、供应商网络、ClickHouse 数据表和多节点部署单独建立外部依赖清单。

- 当需求增加同 Provider 多副本或多节点 PM2 时，按增强项重新估算，不挤入原 V0.1 基线。

# 附录 A 估算摘要

| **指标**       | **结果**                                                                           |
|----------------|------------------------------------------------------------------------------------|
| 阶段 PERT 期望 | 501.8 人日                                                                         |
| 纯工程人月     | 25.1 人月                                                                          |
| 15% 风险缓冲后 | 28.9 人月                                                                          |
| 推荐团队       | 6-7 人                                                                             |
| 推荐日历周期   | 6-7.5 个月 / 15 个双周 Sprint                                                      |
| 关键前提       | 单节点 PM2、单 Provider 单副本、供应商自管 Adapter、共享 PG Cluster/每 Provider DB |

# 附录 B 统一验证命令建议

pnpm format:check

pnpm lint

pnpm typecheck

pnpm build

pnpm protocol:check

pnpm test:unit

pnpm test:contract

pnpm test:integration

pnpm test:security

pnpm test:e2e

pnpm test:frozen-74

pnpm test:provider-packages

pnpm test:pms-config-e2e

pnpm test:pm2-adapter

pnpm verify:platform
