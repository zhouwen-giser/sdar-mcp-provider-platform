**SDAR MCP Provider Platform**

**总体设计说明书**

基于离线 Runtime + UGV/NPC/HA Provider 集合的统一平台升级设计

| **文档版本** | V1.0                                                                                |
|--------------|-------------------------------------------------------------------------------------|
| **文档状态** | 总体设计基线                                                                        |
| **实现基线** | sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip               |
| **目标系统** | SDAR MCP Provider Platform                                                          |
| **适用范围** | PMS 控制面、配置中心、PM2 Runtime Adapter、MCP Tasks Runtime、Provider Package 集合 |
| **日期**     | 2026-07-24                                                                          |

*本说明书中的“基线事实”来自离线交付包；“目标设计”是基于当前产品决策形成的新增平台设计。*

# **文档控制**

| **版本** | **日期**   | **状态**     | **说明**                                                             |
|----------|------------|--------------|----------------------------------------------------------------------|
| V1.0     | 2026-07-24 | 总体设计基线 | 首次形成以离线交付包为母体、融合 PMS 与 MCP Runtime 的平台总体设计。 |

## **阅读约定**

- “基线事实”表示离线代码包中已存在并可定位的代码、文档、测试或报告。

- “目标设计”表示本次平台升级拟新增的系统能力，不代表离线包已经实现。

- “Provider”表示逻辑资源供应能力；“Provider Adapter”表示供应商侧设备接入与领域执行实现；“Runtime”表示统一 MCP Tasks 运行时。

- “平台托管 Provider”仅用于离线包中的内置 Provider、演示或受控部署；生产环境默认采用供应商自管 Adapter。

## **目录**

| **章节**                       | **章节**                          |
|--------------------------------|-----------------------------------|
| 1 概述                         | 2 实现基线与现状评估              |
| 3 产品定位、范围与非目标       | 4 总体设计原则                    |
| 5 总体架构                     | 6 部署与运行架构                  |
| 7 核心组件设计                 | 8 核心领域模型                    |
| 9 配置中心设计                 | 10 PM2 Runtime Adapter 设计       |
| 11 数据与数据库架构            | 12 Provider Package Registry 设计 |
| 13 Runtime 与 Adapter 集成     | 14 Catalog 与 Registry 设计       |
| 15 遥测、业务事件与 ClickHouse | 16 安全设计                       |
| 17 高可用、故障隔离与恢复      | 18 API 与内部接口                 |
| 19 核心流程与状态机            | 20 目标仓库结构                   |
| 21 离线包迁移升级方案          | 22 测试与质量保障                 |
| 23 分阶段实施路线              | 24 风险、约束与待决策项           |
| 25 验收标准                    | 附录 A 基线来源映射               |
| 附录 B 关键配置分类            |                                   |

# **1 概述**

## **1.1 建设背景**

离线交付包已经形成标准 MCP Tasks Runtime、跨语言 Adapter Protocol、UGV Provider、NPC Tank Provider、Home Assistant Climate Provider、业务事件、遥测、数据库持久化和完整验证资产。随着 Provider 数量增加，单纯依靠环境变量和人工启动 Runtime 的方式难以支撑统一配置、数据库准备、多 Runtime 管理、Catalog 治理和 Registry 发布。

因此，本项目不再从空仓库新建 PMS，也不再把 PMS 与 Runtime 视为两个相互独立的产品。目标是以离线包为母体，将 PMS 控制面、配置中心、PM2 Runtime Adapter 和现有 Runtime/Provider 集合统一升级为 SDAR MCP Provider Platform。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>核心结论</strong></p>
<p>代码仓库统一，运行进程与数据库边界继续隔离；PMS 负责期望状态和配置，Runtime 负责 Task Authority，供应商负责 Provider Adapter 和设备侧真实控制。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **1.2 建设目标**

- 将离线交付包升级为统一的 Provider 侧平台 Monorepo，并保留现有 Runtime 行为与验证结果。

- 新增 PMS API、PMS Worker、PMS Web、配置中心、RuntimeDeployment、数据库 Profile 和审计能力。

- 通过 PM2 Runtime Adapter 自动准备 Runtime 数据库、执行版本一致的 Migration、生成启动配置并管理多个独立 Runtime 进程。

- 将 UGV、NPC Tank、Home Assistant 组织为可识别、可校验、可展示的 Provider Package 集合。

- 支持供应商自管 Adapter 的生产接入，同时保留内置 Provider 的测试、演示和受控托管能力。

- 统一 Runtime 配置契约，实现 Draft、Publish、Rollback、Pull、Watch、Ack、LKG 和 restart_required。

- 保持 PMS 停机不影响已运行 Runtime、Task、Scheduler、Recovery 和 Adapter 调用。

## **1.3 文档范围**

本文给出产品定位、逻辑架构、部署架构、组件职责、领域模型、配置中心、进程管理、数据架构、接口、流程、迁移方案、质量保障和验收标准。本文不展开各模块的详细类设计、完整 OpenAPI、全部 SQL DDL 或前端交互原型；这些内容应在后续详细设计与实施任务包中展开。

# **2 实现基线与现状评估**

## **2.1 离线包完整性基线**

| **项目**            | **基线值**                                                            |
|---------------------|-----------------------------------------------------------------------|
| 离线包文件名        | sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip |
| 离线包 SHA-256      | 000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3      |
| 项目名称            | sdar-mcp-tasks-provider-runtime                                       |
| 项目版本            | 2.0.0-rc.1                                                            |
| Node.js 约束        | \>=22 \<23                                                            |
| pnpm 约束           | \>=11 \<12；packageManager=pnpm@11.13.1                               |
| 文件数量            | 803                                                                   |
| 应用数量            | 8                                                                     |
| 共享包数量          | 13                                                                    |
| TypeScript/TSX 文件 | 280                                                                   |
| 测试文件            | 125                                                                   |
| 根 Migration SQL    | 26                                                                    |

## **2.2 现有应用与共享包**

| **类别** | **现有模块**                                        | **平台化定位**                            |
|----------|-----------------------------------------------------|-------------------------------------------|
| 应用     | apps/runtime                                        | 保留为统一 MCP Tasks Runtime              |
| 应用     | apps/ugv-provider-adapter                           | 内置 UGV Provider Package                 |
| 应用     | apps/npc-tank-provider-adapter                      | 内置 NPC Tank Provider Package            |
| 应用     | apps/home-assistant-climate-provider                | 内置 Home Assistant Provider Package      |
| 应用     | mock-\*                                             | 测试 Fixture，不进入生产 Provider 列表    |
| 共享包   | adapter-protocol / operation-registry / task-engine | Runtime 核心，迁移时保持行为              |
| 共享包   | provider-adapter-kit / vehicle-\*                   | Provider 开发与车辆领域复用基础           |
| 共享包   | provider-telemetry / observability                  | 平台遥测和 Provider 遥测基础              |
| 共享包   | conformance-testkit                                 | 平台 Test Center 和 Provider 验证复用资产 |

## **2.3 已验证能力与边界**

| **组件**                    | **已支持声明**                                          | **限制**                                                          |
|-----------------------------|---------------------------------------------------------|-------------------------------------------------------------------|
| MCP Tasks Runtime           | Runtime Component Conformant；冻结协议报告 74/74        | 完整 verify:v2 在离线环境因 PostgreSQL 条件受限，需在目标环境重跑 |
| UGV Provider                | 9 个 Operation；UGV Provider regression complete        | 真实外部设备/MQTT/数据库联调条件需重新确认                        |
| NPC Tank Provider           | 9 个 Operation；Component Complete against Mock Level 1 | 未完成真实 NPC Device MCP、真实 MQTT 和真实资源认证               |
| Home Assistant Climate      | Provider Component Conformant                           | realResourceQualified=false                                       |
| Business Events / Telemetry | 协议、契约和部分验证通过                                | 数据库相关门禁在交付环境标记 PARTIAL_ENVIRONMENT_BLOCKED          |

## **2.4 现有结构的关键问题**

- Runtime Migration 001～023 与 UGV/NPC Provider Migration 024/025 位于同一根目录；Runtime 迁移器默认扫描全部数字 SQL，平台化前必须拆分迁移集合。

- 配置分散在 Runtime、UGV、NPC、Home Assistant 的多个 Zod Schema 和环境变量中，尚无共享配置定义、版本发布和运行时 Ack。

- Provider 信息散落在 Manifest、源码、报告和 Compose 中，尚无 Provider Package Registry。

- 不存在 PMS API、PMS Worker、PMS Web、RuntimeDeployment、RuntimeProcess 和 PM2 进程管理。

- 当前离线包不含 Git 元数据，迁移工程需要显式建立新仓库来源锁和初始提交。

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>迁移前置门禁</strong></p>
<p>任何平台功能开发之前，先锁定离线包 SHA-256、重跑可用静态门禁，并将 Runtime、Provider、协议和报告资产设为受保护基线。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **3 产品定位、范围与非目标**

## **3.1 产品定位**

SDAR MCP Provider Platform 是 Provider 侧统一控制面与标准运行时平台。它将 Provider 管理、Runtime 配置、数据库准备、PM2 进程生命周期、MCP Tasks Runtime、Catalog 治理、Registry 发布和 Provider Package 集合统一到同一 Monorepo。

> 供应商 Provider Adapter  
> ⇅ gRPC Adapter Protocol  
> 标准 MCP Tasks Runtime  
> ⇅ 配置 / 部署 / Catalog / Registry  
> PMS 控制面  
> ⇅ MCP / Registry Snapshot  
> SDAR

## **3.2 平台职责**

- ProviderType、Provider、Resource、Provider Package 和 Operation Catalog 管理。

- RuntimeDeployment、RuntimeProcess、Runtime 版本和期望副本管理。

- PMS 配置中心、配置继承、发布、回滚、Watch、Ack 和 LKG 状态。

- PostgreSQL Cluster/Database Profile、Runtime Database 创建与 Migration 调度。

- PM2 Fork 进程启动、停止、重启、删除、对账和健康检查。

- Registry Snapshot、审计、Console 和验证报告管理。

## **3.3 供应商职责**

- Provider Adapter 的部署、版本、设备连接和真实资源安全。

- Resource Inventory、Operation 实现和设备协议转换。

- Adapter 自身数据库和外部依赖；仅平台内置或受控托管 Provider 可由平台辅助管理。

- 真实设备认证、供应商侧容量和故障处置。

## **3.4 V0.1 非目标**

- 不自动创建或修改供应商业务 Adapter 代码。

- 不建设 Kubernetes、Docker 编排或跨主机调度平台。

- 不让 PMS 访问 Runtime Task 业务表。

- 不让 Runtime 直接写 ClickHouse。

- 不在单个 Node.js 进程内运行多个 Provider Runtime。

- 不做 Legacy 协议自动翻译，不修改冻结协议语义。

- 不在 V0.1 实现复杂灰度发布、流量切分和自动跨数据库迁移。

# **4 总体设计原则**

| **原则**               | **说明**                                                                                             |
|------------------------|------------------------------------------------------------------------------------------------------|
| P1 基线优先            | 离线包是唯一实现基线，现有协议、Runtime 状态机、Migration 和验证资产不得被无证据替换。               |
| P2 代码统一、进程隔离  | PMS 与 Runtime 合并为 Monorepo，但每个 Runtime 保持独立进程和故障边界。                              |
| P3 控制面不进入数据面  | PMS 不代理 MCP 业务流量，不读取或修改 Runtime Task 数据。                                            |
| P4 配置中心优先        | 配置定义、发布、Runtime Client 和 LKG 先于自动部署和复杂治理。                                       |
| P5 Task Authority 单一 | 一个逻辑 Provider 的多个 Runtime 副本必须共享同一 Runtime Database。                                 |
| P6 迁移权威归属        | Runtime 表结构只由 Runtime Migration 维护；Provider 表结构只由相应 Provider Package Migration 维护。 |
| P7 Secret 最小暴露     | PMS 保存 SecretRef，PM2 只注入 Secret 文件路径，日志和审计不得出现明文凭据。                         |
| P8 期望状态对账        | RuntimeDeployment 是期望状态，PM2 状态和 /health/ready 是实际状态，两者持续对账。                    |
| P9 发布内容版本化      | 配置、Catalog 和 Registry Snapshot 使用不可变 Revision 与 Checksum。                                 |
| P10 真实状态诚实       | 内置 Provider 的 Mock/Component 结果不得升级为真实资源认证或系统 Interop Certified。                 |

# **5 总体架构**

<img src="/mnt/data/_platform_docs_md/design-media/media/image1.png" style="width:6.61417in;height:4.75471in" />

*图 1 SDAR MCP Provider Platform 总体架构*

## **5.1 分层说明**

| **层级**        | **主要组件**                                          | **核心职责**                                                            |
|-----------------|-------------------------------------------------------|-------------------------------------------------------------------------|
| 交互与管理层    | pms-web、pms-api                                      | 管理员接入、配置、部署、状态、Catalog、Registry 和审计                  |
| 控制与编排层    | pms-worker、PM2 Runtime Adapter、Database Provisioner | 期望状态对账、数据库准备、迁移、PM2 进程操作、健康与发布                |
| 标准运行时层    | apps/runtime 及现有 Runtime Packages                  | MCP、Task Authority、Scheduler、Recovery、Notification、Adapter Gateway |
| Provider 实现层 | UGV/NPC/HA Provider Package、外部供应商 Adapter       | 设备连接、Resource Inventory、Operation 和真实副作用                    |
| 共享基础设施层  | PostgreSQL、Secret Store、Collector、ClickHouse       | 控制面存储、Task Authority、Secret、遥测汇聚和分析                      |

## **5.2 依赖方向**

> pms-web → pms-api → pms application/domain  
> pms-worker → runtime-deployment ports → pm2-runtime-adapter / postgres-provisioner  
> mcp-runtime → runtime domain / task-engine / adapter-protocol / runtime persistence  
> provider-adapter → provider-adapter-kit / adapter-protocol / provider-specific persistence  
> PMS 禁止依赖 runtime task repositories；Runtime 禁止依赖 PMS persistence。

# **6 部署与运行架构**

<img src="/mnt/data/_platform_docs_md/design-media/media/image2.png" style="width:6.61417in;height:2.57859in" />

*图 2 单节点 PM2 部署拓扑*

## **6.1 V0.1 部署形态**

- 单节点或少量固定节点；PMS API、Worker、Web 与 PM2 Daemon 部署在受控服务器。

- 每个逻辑 Provider 默认启动一个独立 Runtime PM2 Fork 进程；不同 Provider 使用不同端口。

- 同一 Provider 如需多个 Runtime 副本，必须共享同一 Runtime Database；稳定 MCP 入口由反向代理或 Runtime Gateway 提供。

- Provider Adapter 生产环境默认部署在供应商节点，平台通过受控网络连接其 gRPC Endpoint。

## **6.2 PM2 运行模式**

| **决策项** | **V0.1 选择**                           | **原因**                                                                       |
|------------|-----------------------------------------|--------------------------------------------------------------------------------|
| PM2 模式   | Fork Mode                               | 避免 Runtime 后台任务、gRPC 端口和本地资源在 Cluster Mode 中产生隐式共享与冲突 |
| 进程粒度   | 一个 Runtime 副本一个 PM2 Application   | 独立配置、端口、PID、日志、重启计数和故障边界                                  |
| 启动恢复   | pm2 startup/save + PMS 对账             | PM2 恢复不代表期望状态正确，仍需以 PMS 为权威重新对账                          |
| 可用性判定 | PM2 online + health/live + health/ready | PM2 online 不能证明数据库、Adapter、Recovery 和 MCP 已就绪                     |

## **6.3 稳定 MCP 入口**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>多副本约束</strong></p>
<p>单副本可以直接发布 Runtime Endpoint；同一 Provider 多副本必须引入稳定服务入口。V0.1 可采用 Nginx/HAProxy 或轻量 Runtime Gateway，PMS 不直接发布临时 PID/端口作为长期 Registry 地址。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **7 核心组件设计**

| **组件**                  | **职责**                                                                 | **边界**                                    |
|---------------------------|--------------------------------------------------------------------------|---------------------------------------------|
| pms-api                   | 管理 REST/OpenAPI、Runtime Config Pull/Ack、Registry Snapshot、审计查询  | 不得执行 PM2 或数据库管理长任务             |
| pms-worker                | 任务队列、配置发布、部署对账、健康、Catalog/Registry 构建                | 通过内部 Port 调用基础设施 Adapter          |
| pms-web                   | Provider、Runtime、配置、数据库 Profile、Catalog、Registry、审计页面     | 不直接访问数据库                            |
| pm2-runtime-adapter       | 数据库准备、Migration 调度、配置文件生成、PM2 进程管理、健康检查         | 不维护 Runtime Task 表结构，不参与 MCP 业务 |
| postgres-provisioner      | 创建 Database/Role、权限、连接 Profile 和 SecretRef                      | 不得把管理凭据下发给 Runtime                |
| configuration-center      | 定义、继承、Draft/Publish/Rollback、Watch、Ack、LKG 状态                 | 不得把任意环境变量都声明为可热更新          |
| provider-package-registry | 加载内置 Provider 包定义、配置 Schema、Migration Set、兼容版本和验证状态 | 不得扫描源码推断生产能力                    |
| mcp-runtime               | 保留现有 MCP/Task/Scheduler/Recovery/Notification/Telemetry              | 不嵌入 PMS 控制面逻辑                       |

## **7.1 PMS API**

- 使用版本化 \`/api/v1\` 管理接口和独立 Runtime Client 接口。

- 所有写操作生成 Audit，关键操作要求管理员二次确认。

- 长时操作返回 Operation/Job ID，由 Worker 异步执行。

- API 只表达期望状态，不等待 PM2 全流程完成后才返回。

## **7.2 PMS Worker**

- 通过数据库 Job Lease 实现多副本安全领取。

- 执行 RuntimeDeployment Reconcile、配置 Revision 发布、健康探测、Catalog 更新和 Registry Snapshot 发布。

- 对外网络调用和 PM2 操作不持有 PMS 数据库长事务。

## **7.3 现有 Runtime 保留策略**

- 保留 apps/runtime 及 domain、task-engine、mcp-protocol、adapter-protocol、operation-registry、persistence-postgres 等包。

- 第一阶段只做目录迁移、配置入口扩展和平台接入，不重写 Task 状态机。

- Runtime Component Conformant 74/74 是回归基线；任何平台 PR 都不得弱化冻结协议门禁。

# **8 核心领域模型**

## **8.1 聚合与关系**

> ProviderType 1 ── N Provider  
> ProviderPackage 1 ── N Provider（可选来源模板）  
> Provider N ── N Resource（provider_resource_binding）  
> Provider 1 ── N Operation（来自 Catalog Snapshot）  
> Provider 1 ── N RuntimeDeployment  
> RuntimeDeployment 1 ── N RuntimeProcess  
> RuntimeDeployment N ── 1 RuntimeDatabaseProfile  
> ConfigurationTarget 1 ── N ConfigRevision

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>重要修正</strong></p>
<p>不得建立 Provider.resourceId 强制单资源关系。现有 Runtime/Adapter 协议允许 Operation 通过 arguments 中的 resourceId 绑定多个资源。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

## **8.2 核心实体**

| **实体**          | **关键字段**                                                                               | **说明**                       |
|-------------------|--------------------------------------------------------------------------------------------|--------------------------------|
| ProviderPackage   | packageId、version、providerType、adapterEntry、configSchema、migrationSet、qualification  | 离线包内置 Provider 的标准描述 |
| Provider          | providerId、providerTypeId、hostingMode、adapterEndpoint、status                           | 逻辑 Provider 身份             |
| Resource          | environment、resourceId、resourceType、metadata、status                                    | 可被 Provider 操作的资源实例   |
| Operation         | providerId、operationName、catalogRevision、schemas、taskExecutionProfile、resourceBinding | 由 tools/list 权威生成         |
| RuntimeDeployment | deploymentId、providerId、desiredState、desiredReplicas、runtimeVersion、profiles          | Runtime 期望状态聚合           |
| RuntimeProcess    | instanceId、pm2Name、pid、port、processState、readinessState、configRevision               | 实际 PM2 进程投影              |
| DatabaseProfile   | clusterRef、databaseMode、databaseName、roleRef、secretRefs、sslMode                       | 数据库基础设施配置             |
| ConfigRevision    | target、group、dataId、revision、checksum、applyMode、content                              | 不可变配置版本                 |
| CatalogSnapshot   | providerId、revision、checksum、operations、discoveredAt                                   | 不可变 Operation Catalog       |
| RegistrySnapshot  | environment、revision、checksum、provider projections                                      | 供 SDAR 消费的发布快照         |

## **8.3 Provider Hosting Mode**

| **模式**         | **Adapter 生命周期**               | **平台数据库责任**                         | **适用**                                  |
|------------------|------------------------------------|--------------------------------------------|-------------------------------------------|
| vendor_managed   | 供应商负责                         | 平台只创建 Runtime Database                | 生产环境默认模式                          |
| platform_managed | 平台可通过受控方式启动内置 Adapter | 平台创建 Runtime DB 和 Provider Adapter DB | 离线包内置 Provider、测试、演示或封闭部署 |

# **9 配置中心设计**

<img src="/mnt/data/_platform_docs_md/design-media/media/image3.png" style="width:6.61417in;height:0.37345in" />

*图 3 配置发布、应用与 Ack 生命周期*

## **9.1 配置业务键**

> environment  
> + targetType  
> + targetId  
> + configGroup  
> + dataId

targetType 至少支持 environment、provider_type、provider、runtime_deployment、runtime_instance 和 collector。该模型取代仅以 providerId 为目标的配置键，使 Runtime 启动配置、Provider 配置和 Collector/ClickHouse 配置能够统一管理。

## **9.2 配置继承**

> runtime_instance  
> \> runtime_deployment  
> \> provider  
> \> provider_type  
> \> environment  
> \> system_default

继承只适用于配置定义允许覆盖的字段。Provider ID、Deployment ID、协议模式和 Task Authority Identity 等不可变字段不能通过普通配置覆盖。

## **9.3 配置生效模式**

| **Apply Mode**     | **典型配置**                                                     | **运行行为**                                                |
|--------------------|------------------------------------------------------------------|-------------------------------------------------------------|
| hot_reload         | OTLP 开关、日志级别、Sampling、部分 Poll Interval 和限流         | 在线应用，成功后写 LKG                                      |
| reconnect_required | OTLP Endpoint、Outbox Webhook Endpoint                           | 重建对应 Client/Exporter，不停止 Task Engine                |
| restart_required   | 数据库、Adapter Endpoint、HTTP 端口、Provider Telemetry 监听端口 | Runtime Ack 为 restart_required，由管理员或部署流程安排重启 |
| immutable          | Provider ID、Deployment ID、协议模式、Task Authority Identity    | 在线修改直接拒绝                                            |

## **9.4 共享配置契约**

离线包当前在 apps/runtime、UGV、NPC 和 Home Assistant 中分别使用 Zod Schema。平台升级应抽取共享 Configuration Definition，由同一份定义生成 Runtime Validator、JSON Schema、PMS 表单、默认值、Secret 路径、Apply Mode 和生产环境约束。

| **配置组**                | **来源基线**                              | **目标处理**                                           |
|---------------------------|-------------------------------------------|--------------------------------------------------------|
| runtime.database          | DATABASE_URL、DATABASE_POOL_MAX           | Profile + SecretRef；restart_required                  |
| runtime.otel              | OTEL_ENABLED、OTEL_EXPORTER\_\*           | 开关热更新，Endpoint 重连，TLS/SecretRef               |
| runtime.providerTelemetry | PROVIDER_TELEMETRY\_\*                    | 监听类重启，容量类按能力热更新                         |
| runtime.businessEvents    | BUSINESS_EVENTS\_\*                       | 开关、容量、Retention 和 Ready 依赖策略                |
| runtime.worker            | SCHEDULER/RECOVERY/COMMAND/TTL/OUTBOX\_\* | 按定义区分热更新和重启                                 |
| provider.ugv              | UGV\_\*                                   | 生成 UGV Provider 配置 Schema 和 Secret 字段           |
| provider.npcTank          | NPC_TANK\_\*                              | 生成 NPC Provider 配置 Schema 和能力条件               |
| provider.climate          | HOME_ASSISTANT\_\*、CLIMATE\_\*           | 生成 Home Assistant 配置 Schema                        |
| collector.clickhouse      | 当前离线包未直接实现                      | 新增 Collector 目标配置，Runtime 不直接连接 ClickHouse |

## **9.5 Runtime Config Client**

- Runtime 启动依赖 Bootstrap Config 与本地 Secret 文件，PMS 不成为冷启动唯一依赖。

- Runtime 启动后使用 Config Token 拉取 Published Revision，并通过 ETag/304 减少重复传输。

- 完整校验通过后写 Staging；应用成功才替换 Active 与 LKG。

- PMS 不可用或新配置损坏时继续使用 LKG。

- Ack 状态至少包括 applied、rejected、restart_required、stale 和 unavailable。

# **10 PM2 Runtime Adapter 设计**

## **10.1 定位与组成**

PM2 Runtime Adapter 是 PMS 的本机基础设施适配层，由 pms-worker 通过内部接口调用。名称虽然包含 PM2，但其职责包括数据库准备、Runtime Migration、启动配置生成、PM2 进程管理和健康状态回写。为避免单体实现失控，内部组合 PostgresProvisioner、RuntimeMigrationRunner、BootstrapConfigRenderer、Pm2ProcessManager 和 RuntimeHealthProbe。

## **10.2 内部接口**

> interface RuntimeInfrastructureAdapter {  
> provisionDatabase(spec): Promise\<ProvisionedDatabase\>;  
> migrateDatabase(spec): Promise\<MigrationResult\>;  
> renderBootstrapConfig(spec): Promise\<BootstrapConfigResult\>;  
> start(spec): Promise\<RuntimeProcessStatus\>;  
> stop(instanceId): Promise\<void\>;  
> restart(instanceId, options): Promise\<void\>;  
> delete(instanceId): Promise\<void\>;  
> inspect(instanceId): Promise\<RuntimeProcessStatus\>;  
> reconcile(deployment): Promise\<RuntimeDeploymentStatus\>;  
> }

## **10.3 进程命名与配置**

> sdar-runtime-{environment}-{providerSlug}-{ordinal}  
> 例如：  
> sdar-runtime-prod-ugv-01  
> sdar-runtime-prod-ugv-02  
> sdar-runtime-test-npc-tank-01

| **类别** | **多副本共享**                                         | **每进程独立**                         |
|----------|--------------------------------------------------------|----------------------------------------|
| 身份     | PROVIDER_ID、deploymentId                              | PMS_INSTANCE_ID、PM2 ID、PID           |
| 网络     | Adapter Endpoint、稳定外部 MCP Endpoint                | Runtime PORT、OTEL_SERVICE_INSTANCE_ID |
| 数据     | Runtime Database、Provider 配置                        | 本地 Cache/LKG 路径、日志路径          |
| 版本     | runtimeVersion、protocolVersion、configContractVersion | observedVersion、restartCount          |

## **10.4 Secret 注入**

- 禁止把 DATABASE_URL、Token、TLS Private Key 直接写入 PM2 Ecosystem 文件或 PMS 日志。

- PM2 Adapter 将 Secret 写入受控目录的 0600 文件，并仅注入 \`\*\_FILE\` 环境变量。

- Runtime 需要新增 DATABASE_URL_FILE、PMS_CONFIG_TOKEN_FILE 和其他 Secret File 读取支持。

- Secret 文件目录按 deploymentId/instanceId 隔离，进程删除后按保留策略清理。

## **10.5 数据库切换约束**

<table>
<colgroup>
<col style="width: 100%" />
</colgroup>
<thead>
<tr class="header">
<th><p><strong>禁止无条件滚动切换 Task Authority</strong></p>
<p>数据库配置变化不得使用普通 PM2 reload 让新旧数据库进程并存。应先阻断新任务、确认运行状态、停止全部副本、更新配置、执行目标库 Migration，再统一启动并验证。</p></th>
</tr>
</thead>
<tbody>
</tbody>
</table>

# **11 数据与数据库架构**

<img src="/mnt/data/_platform_docs_md/design-media/media/image4.png" style="width:6.49606in;height:6.06679in" />

*图 4 平台数据与数据库分层*

## **11.1 PMS Control Plane Database**

- 保存 Provider、ProviderPackage、Resource、RuntimeDeployment、RuntimeProcess、DatabaseProfile、ConfigRevision、Ack、CatalogSnapshot、RegistrySnapshot、Audit 和 Job Lease。

- 不保存 Runtime Task、Command、Scheduler、Recovery、Outbox 等业务权威数据。

## **11.2 Runtime Task Authority Database**

一个逻辑 Provider 对应一个 Runtime Task Authority Database；同一 Provider 的多个 Runtime 副本共享。不同 Provider 可共享 PostgreSQL Cluster，但 V0.1 推荐每个 Provider 使用独立 Database，以保留迁移、备份、权限和故障边界。

## **11.3 Provider Adapter Database**

UGV 和 NPC Adapter 在离线包中拥有独立持久化表与独立连接配置。生产环境 vendor_managed 模式下由供应商负责；platform_managed 内置 Provider 模式下，平台可以根据 Provider Package 的数据库要求创建并执行 Provider Migration。

## **11.4 Migration 集合拆分**

> migrations/  
> ├── runtime/ \# 原 001～023，保持文件内容和历史标识  
> ├── providers/  
> │ ├── ugv/ \# 原 024_ugv_provider.sql  
> │ └── npc-tank/ \# 原 025_npc_tank_provider.sql  
> └── pms/ \# 新增 PMS Migration

- Runtime Migration Runner 只能扫描 migrations/runtime。

- Provider Package 指定自己的 migrationSet 和 Migration Runner。

- 已交付 SQL 语义不得静默修改；移动后生成映射清单和旧路径到新路径的完整性报告。

- 继续使用 Advisory Lock、Migration Version Table 和 Checksum 保护。

## **11.5 PostgreSQL Provisioning**

| **凭据**                    | **使用方**                              | **权限**                                |
|-----------------------------|-----------------------------------------|-----------------------------------------|
| Provisioning Credential     | PM2 Runtime Adapter/PostgresProvisioner | 受限 CREATEDB/CREATEROLE 或等效管理权限 |
| Runtime Credential          | 某逻辑 Provider 的 Runtime 副本         | 仅自身 Runtime Database 的 DDL/DML      |
| Provider Adapter Credential | 平台托管内置 Adapter                    | 仅自身 Provider Database                |
| PMS Credential              | PMS API/Worker                          | 仅 PMS Control Plane Database           |

# **12 Provider Package Registry 设计**

## **12.1 目标**

Provider Package Registry 将离线包中分散的 Manifest、入口、配置、Migration、验证报告和兼容信息组织为稳定的包描述。PMS 通过包描述加载 Provider 集合，而不是扫描源码或报告猜测能力。

## **12.2 包描述核心字段**

> {  
> "schemaVersion": "1.0",  
> "packageId": "builtin.isr.vehicle.ugv",  
> "packageVersion": "1.0.0",  
> "providerType": "isr.vehicle.ugv",  
> "hostingModes": \["vendor_managed", "platform_managed"\],  
> "adapter": { "entry": "...", "configSchemaId": "...", "migrationSet": "..." },  
> "runtime": { "compatibleRuntimeVersion": "2.0.0-rc.1" },  
> "qualification": { "componentStatus": "passed", "realResourceStatus": "pending" }  
> }

## **12.3 初始 Provider Package**

| **Package**            | **基线能力**                                                     | **资格状态**                                               | **平台用途**                              |
|------------------------|------------------------------------------------------------------|------------------------------------------------------------|-------------------------------------------|
| UGV                    | 9 个 vehicle\_\* Operation；vehicle:ugv1；Business Event Sources | 回归完成；真实环境资格需复核                               | 内置参考、演示、受控部署、供应商模板      |
| NPC Tank               | 9 个 vehicle\_\* Operation；条件化 EO Scan 与导航选择            | Component Complete against Mock Level 1                    | 内置参考、模拟测试、供应商模板            |
| Home Assistant Climate | climate.\* 状态与控制 Operation                                  | Provider Component Conformant；realResourceQualified=false | 非车辆类 Provider 参考实现                |
| Mock Device/Publisher  | Device MCP/MQTT Fixture                                          | 测试资产                                                   | 仅 Test Center/E2E，不发布为生产 Provider |

## **12.4 包安装与版本**

- V0.1 使用仓库内置目录和版本锁，不实现在线下载任意 Provider 代码。

- ProviderPackage 版本必须绑定兼容 Runtime、配置契约、协议基线和 Migration Set。

- 包升级前运行 Package Self-check 和对应 Provider Conformance。

# **13 Runtime 与 Adapter 集成**

## **13.1 现有职责保持**

Runtime 继续通过 gRPC/Protobuf Adapter Protocol 调用 DescribeProvider、CheckAvailability、StartOperation、GetExecution、RequestCancel、ReconcileExecution、Update/Pause/Resume、StreamExecutionEvents 和 ListResources。Runtime 负责标准 MCP/Task 语义，Adapter 负责资源事实与真实控制。

## **13.2 Provider 身份校验**

> PMS Provider.providerId  
> = Runtime Bootstrap PROVIDER_ID  
> = Adapter ProviderManifest.providerId  
> = Catalog Snapshot providerId

任一不一致都必须阻断 RuntimeDeployment 进入 ACTIVE，并记录 PROVIDER_ID_MISMATCH。

## **13.3 Resource 与 Operation**

- Operation 仍由 Adapter Manifest 映射为 tools/list，管理员不得手工修改 Input/Output Schema。

- 资源 ID 作为 Operation arguments 中的字段传入，不为每个 Resource 动态生成 Tool。

- Provider 与 Resource 使用多对多绑定；Resource Inventory 可以来自 Adapter ListResources、包内静态描述或供应商管理接口。

## **13.4 内置与外部 Adapter**

| **能力**         | **vendor_managed**    | **platform_managed**           |
|------------------|-----------------------|--------------------------------|
| Adapter 启停     | 供应商负责            | 可由平台受控启动               |
| Provider DB      | 供应商负责            | 平台可根据包定义创建           |
| Runtime DB       | 平台负责              | 平台负责                       |
| Catalog Discover | 平台通过 Runtime 执行 | 平台通过 Runtime 执行          |
| 真实设备资格     | 供应商与系统联调证明  | 必须单独完成，不继承 Mock 结果 |

# **14 Catalog 与 Registry 设计**

## **14.1 Catalog 权威**

Operation Catalog 的唯一权威是 Runtime 的 \`server/discover + tools/list\`。Provider Package Manifest 只用于接入前预览、配置和验证，不能替代正式 MCP Catalog。

## **14.2 Catalog Snapshot**

- 以 providerId、catalogRevision、canonical checksum 标识不可变快照。

- 内容包括 protocol baseline、server capabilities、排序后的 Tool、Input/Output Schema、Task Execution Profile 和资源绑定。

- 发现结果变化时生成新 Revision；健康探测耗时和普通心跳不改变 Catalog Revision。

## **14.3 Registry Snapshot**

- 按 environment 发布可被 SDAR 消费的 Provider Runtime Projection。

- V0.1 发布 providerId/serverId、protocolMode、catalogRevision、effectiveEndpoint、Tool Projection 和可选 Resource Binding。

- 不发布明文凭据、Runtime Task 数据、测试结果和内部 PM2 信息。

- Snapshot 使用 Checksum、ETag/304、历史、Diff、Watch 和 LKG。

## **14.4 Revision 规则**

> build candidate → canonicalize → checksum  
> checksum == active checksum：不创建 Revision  
> checksum != active checksum：短事务创建并激活 Revision  
> commit 后发送 Watch 通知

# **15 遥测、业务事件与 ClickHouse**

## **15.1 现有基线**

离线包已经包含 Runtime Observability、Provider Telemetry Ingress、Provider Ops Outbox、Business Events Profile 和相关报告。平台化应复用这些资产，将分散的环境变量纳入配置中心，而不是重新设计另一条遥测链路。

## **15.2 推荐数据链路**

> Runtime / Provider Adapter  
> ↓ OTLP / Provider Telemetry / Outbox  
> Collector / Telemetry Gateway  
> ↓ 批量、重试、脱敏、映射  
> 共享 ClickHouse

## **15.3 ClickHouse 共享方式**

- ClickHouse Cluster、Database 和主题表原则上共享，通过 environment、providerId、runtimeInstanceId、resourceId、taskId 区分。

- Runtime 不持有 ClickHouse 凭据，不为每个 Runtime 创建独立 ClickHouse Database。

- PMS 配置中心管理 Runtime→Collector 和 Collector→ClickHouse 两级配置。

## **15.4 遥测开关与故障隔离**

- 关闭 OTLP 或 Provider Telemetry 不得停止 Task Engine。

- Collector/ClickHouse 不可用时采用有界队列、重试和丢弃策略，不能无限占用 Runtime 内存。

- 配置应用失败保留旧 Exporter/LKG，并向 PMS 返回结构化 Ack。

# **16 安全设计**

| **安全域** | **要求**                                                                                                          |
|------------|-------------------------------------------------------------------------------------------------------------------|
| 身份认证   | PMS 管理 API 使用管理员/只读角色；Runtime Config Client 使用最小权限 Token；Adapter gRPC 使用 TLS/mTLS 或受控网络 |
| Secret     | PMS 只保存 SecretRef；PM2 注入 \`\*\_FILE\`；文件 0600；日志、审计和报告脱敏                                      |
| 数据库     | PMS、Runtime、Provider Adapter 使用不同 Role；Provisioning Credential 不下发给 Runtime                            |
| 进程       | PM2 仅允许固定 Runtime 入口、受控 cwd、允许列表环境变量和资源上限                                                 |
| 网络       | Adapter Endpoint、OTLP、Webhook 实施 Scheme、Host/CIDR 和 TLS 策略；生产环境失败关闭                              |
| 协议       | 冻结协议 Hash 校验；Legacy 只检测不翻译；tools/list 与 Task Profile 严格校验                                      |
| 审计       | Provider、配置、数据库、Migration、PM2、Catalog、Registry 的每次写操作生成不可变 Audit                            |

## **16.1 PM2 权限边界**

pms-worker 或 PM2 Runtime Adapter 运行账号只能管理平台命名空间内的 PM2 Application、受控目录和受控 Secret 路径。不得提供任意脚本、任意 cwd、任意环境变量或任意命令执行接口。

## **16.2 数据安全**

- PMS 不读取 Runtime Task 业务数据。

- Provider Evidence 不得包含 SDAR 内部 requirementId。

- 武器、损伤、命中等敏感业务字段继续遵循 UGV/NPC 现有安全过滤边界。

- ClickHouse 数据入口执行字段白名单、大小限制和保留策略。

# **17 高可用、故障隔离与恢复**

## **17.1 PMS 故障**

PMS 停机时，已启动 Runtime 继续运行，继续连接 Adapter、执行 Scheduler/Recovery、响应 MCP 和维护 Task Authority。受影响的是新 Provider 接入、配置发布、PM2 扩缩、Catalog/Registry 更新和集中审计查询。

## **17.2 Runtime 故障**

- PM2 根据 restartDelay、maxRestarts、maxMemoryRestart 等策略重启进程。

- Runtime 依赖 PostgreSQL 持久化和现有 Recovery 机制恢复任务。

- PMS Worker 根据 RuntimeProcess 心跳和 readiness 更新 observedState，不把 PM2 online 误判为 ACTIVE。

## **17.3 数据库故障**

- Runtime Database 不可用时 Runtime readiness 失败，不允许新部署进入 ACTIVE。

- PMS Database 不可用不应导致 PM2 主动停止 Runtime。

- Migration 失败保留数据库和阶段状态，禁止自动清库。

## **17.4 Provider Adapter 故障**

- Runtime 根据现有 Adapter Health、Manifest Poll 和 Recovery 逻辑进入 not_ready/degraded。

- PMS 记录 Adapter Unreachable，但不越权修改设备状态。

- 恢复后重新校验 ProviderManifest 和 Catalog Drift。

# **18 API 与内部接口**

## **18.1 管理 API 分组**

| **分组**           | **示例接口**                                                             |
|--------------------|--------------------------------------------------------------------------|
| Provider Package   | GET /api/v1/provider-packages；GET /api/v1/provider-packages/{packageId} |
| Provider           | POST/GET /api/v1/providers；enable/disable/retire；resource bindings     |
| Runtime Deployment | POST/GET /api/v1/runtime-deployments；start/stop/restart/scale/reconcile |
| Runtime Process    | GET /api/v1/runtime-processes；GET /{instanceId}；logs/status            |
| Database Profile   | POST/GET /api/v1/database-profiles；validate/provision status            |
| Configuration      | Draft/Publish/Rollback；Watch；History；Diff                             |
| Catalog            | GET Provider operations/catalogs；rediscover；compare                    |
| Registry           | latest/history/diff/watch/bootstrap                                      |
| Audit/System       | audit-logs；system-status；protocol-baseline                             |

## **18.2 Runtime Client API**

| **接口**                                 | **用途**                                                        |
|------------------------------------------|-----------------------------------------------------------------|
| GET /api/v1/runtime-config/latest        | 按 deployment/instance 获取最新 Published Config，支持 ETag/304 |
| GET /api/v1/runtime-config/watch         | SSE Revision 提示，断线后通过 latest 恢复                       |
| POST /api/v1/runtime-config/acks         | 上报 applied/rejected/restart_required 和 activeRevision        |
| POST /api/v1/runtime-instances/heartbeat | 上报 Runtime Version、readiness、configRevision 和 endpoint     |

## **18.3 内部基础设施 Port**

PM2 和数据库 Provisioning 接口仅在应用内部以 TypeScript Port/Adapter 形式存在，V0.1 不对外暴露任意命令执行 HTTP API。

# **19 核心流程与状态机**

## **19.1 Provider 接入与 Runtime 启动**

<img src="/mnt/data/_platform_docs_md/design-media/media/image5.png" style="width:3.26772in;height:8.66361in" />

*图 5 Provider 接入和 Runtime 激活流程*

## **19.2 RuntimeDeployment 状态机**

<img src="/mnt/data/_platform_docs_md/design-media/media/image6.png" style="width:6.69291in;height:1.29025in" />

*图 6 RuntimeDeployment 状态机*

| **状态**              | **进入条件**                          | **退出条件**                                     |
|-----------------------|---------------------------------------|--------------------------------------------------|
| REQUESTED             | 管理员创建部署                        | 基础配置校验完成                                 |
| DATABASE_PROVISIONING | 需要平台创建 Runtime DB               | Database/Role/SecretRef 创建成功                 |
| MIGRATING             | Database Ready                        | 指定 Runtime Version Migration 成功              |
| CONFIG_PREPARING      | Migration Ready                       | 继承配置解析、Secret 文件和端口生成成功          |
| STARTING              | 配置可用                              | PM2 进程 online                                  |
| HEALTH_CHECKING       | PM2 online                            | live/ready 全部通过                              |
| DISCOVERING           | Runtime ready                         | server/discover、tools/list、Catalog Commit 通过 |
| ACTIVE                | Catalog 有效且 Registry 可发布        | 故障、配置变更、停止或退役                       |
| DEGRADED              | 部分依赖异常但已有 Task 仍可恢复/服务 | 恢复或进入 DRAINING/FAILED                       |

## **19.3 配置发布流程**

- 管理员创建 Draft，PMS 使用共享配置定义校验。

- Publish 创建不可变 Revision 和 Checksum；Watch 只发送 Revision 提示。

- Runtime 拉取、校验、Staging、应用；成功写 LKG，失败保留旧配置。

- Runtime Ack 更新实例状态；restart_required 不自动滚动数据库切换。

## **19.4 扩缩容流程**

- 管理员修改 desiredReplicas。

- Worker 对比 PM2 Actual Process 数量，生成 Start/Drain/Stop 动作。

- 新增副本共享 Provider Runtime Database，生成独立 instanceId 和 port。

- 缩容优先进入 DRAINING；确认无不安全中断后停止进程。

# **20 目标仓库结构**

> sdar-mcp-provider-platform/  
> ├── apps/  
> │ ├── pms-api/  
> │ ├── pms-worker/  
> │ ├── pms-web/  
> │ ├── runtime/  
> │ ├── ugv-provider-adapter/  
> │ ├── npc-tank-provider-adapter/  
> │ ├── home-assistant-climate-provider/  
> │ └── mock-\*/  
> ├── packages/  
> │ ├── pms-domain/  
> │ ├── pms-persistence-postgres/  
> │ ├── configuration-center/  
> │ ├── runtime-configuration-contract/  
> │ ├── runtime-config-client/  
> │ ├── runtime-deployment/  
> │ ├── pm2-runtime-adapter/  
> │ ├── postgres-provisioner/  
> │ ├── provider-package-registry/  
> │ ├── registry-snapshot/  
> │ ├── protocol-contract/  
> │ └── \[现有 Runtime/Provider Packages 保留\]  
> ├── provider-packages/  
> │ ├── ugv/provider-package.json  
> │ ├── npc-tank/provider-package.json  
> │ └── home-assistant-climate/provider-package.json  
> ├── migrations/  
> │ ├── pms/  
> │ ├── runtime/  
> │ └── providers/  
> ├── protocol/  
> ├── tests/  
> ├── deploy/pm2/  
> └── reports/

## **20.1 包依赖约束**

- pms-domain 不依赖 Fastify、React、PM2 或 PostgreSQL Client。

- pm2-runtime-adapter 依赖 runtime-deployment Port，不反向依赖 PMS API。

- runtime-config-client 依赖共享配置契约，不依赖 PMS Persistence。

- 现有 Runtime Packages 不依赖 pms-domain。

# **21 离线包迁移升级方案**

## **21.1 迁移策略**

- 离线包 SHA-256 作为来源锁，解压目录作为初始导入内容。

- 创建新的 \`sdar-mcp-provider-platform\` Git 仓库和初始 Baseline Commit。

- 保留原文件路径的第一提交，再分步骤移动，便于审计和差异追踪。

- 迁移期间禁止同时进行 Runtime 核心重构和 PMS 功能开发。

## **21.2 迁移批次**

| **阶段**            | **主要工作**                                              | **门禁**                            |
|---------------------|-----------------------------------------------------------|-------------------------------------|
| M0 基线锁           | 校验 ZIP/SHA256SUMS/Manifest；盘点工具链与环境阻断        | 静态基线和来源报告生成              |
| M1 仓库升级         | 重命名项目、增加平台 README/ADR、保留现有构建             | 原 Runtime 静态和冻结协议门禁不回退 |
| M2 Migration 拆分   | runtime/providers/pms 目录与 Runner 拆分                  | 空库和升级路径测试通过              |
| M3 Provider Package | UGV/NPC/HA 包描述、配置与资格状态                         | 包 Schema 和 Self-check 通过        |
| M4 共享配置契约     | 抽取 Runtime/Provider 配置定义                            | 现有配置校验回归一致                |
| M5 PMS 核心         | API/Worker/Web/DB/Config Center                           | Draft/Publish/Rollback/Pull/Ack E2E |
| M6 PM2 与数据库     | Database Profile、Provisioner、Migration Runner、PM2 管理 | 自动启动 Runtime 和健康验证         |
| M7 Catalog/Registry | Discover、Catalog、Registry Snapshot、SDAR 接入           | 真实 Runtime Catalog E2E            |
| M8 全量发布         | 安全、审计、故障、文档和最终报告                          | Platform verify 全绿                |

## **21.3 兼容与回滚**

- 合并后仍保留原 Runtime 启动方式和环境变量兼容入口，平台能力以增量方式开启。

- 首次平台版本不删除 Compose、Kubernetes 或原 Provider 验证脚本。

- 每个迁移阶段独立提交，可回退到上一阶段，不通过修改已应用 Migration 回滚。

# **22 测试与质量保障**

## **22.1 回归基线**

- 冻结协议 Conformance 74/74。

- UGV Provider 现有单元、契约、集成、安全和 gRPC E2E。

- NPC Tank Provider 现有 28 项门禁及 UGV 回归。

- Home Assistant Climate Provider 组件验证。

- Business Events、Telemetry、Recovery、Security 和 Capacity 现有资产。

## **22.2 新增测试层次**

| **层次**     | **关键场景**                                                                         |
|--------------|--------------------------------------------------------------------------------------|
| 单元         | 配置继承、Apply Mode、状态机、包定义、进程命名、Secret 路径                          |
| 数据库集成   | PMS Migration、Runtime Migration Set 隔离、Provider Migration、Database Provisioning |
| PM2 集成     | Start/Stop/Restart/Delete、崩溃重启、状态对账、端口冲突                              |
| 配置 E2E     | Publish→Pull→Apply→Ack；LKG；PMS 停机；restart_required                              |
| Provider E2E | UGV/NPC/HA 包加载、Runtime 启动、Discover、Catalog                                   |
| 系统 E2E     | 管理员接入→数据库→Migration→PM2→ready→Catalog→Registry→SDAR 调用                     |
| 故障         | PMS 停机、Runtime 崩溃、DB 不可用、Adapter 不可达、配置损坏、迁移失败                |
| 安全         | Secret 泄漏、任意 PM2 脚本、越权数据库、SSRF、日志脱敏                               |

## **22.3 统一验证命令**

> pnpm format:check  
> pnpm lint  
> pnpm typecheck  
> pnpm build  
> pnpm protocol:check  
> pnpm test:unit  
> pnpm test:contract  
> pnpm test:integration  
> pnpm test:security  
> pnpm test:e2e  
> pnpm test:frozen-74  
> pnpm test:provider-packages  
> pnpm test:pms-config-e2e  
> pnpm test:pm2-adapter  
> pnpm verify:platform

# **23 分阶段实施路线**

| **优先级** | **阶段**                                   | **可验收效果**                                                 |
|------------|--------------------------------------------|----------------------------------------------------------------|
| P0         | 基线导入与 Migration 拆分                  | 平台仓库可构建；Runtime 和 Provider Migration 不再混用         |
| P1         | 共享配置契约与 PMS 配置中心                | 管理员可发布遥测开关；Runtime Pull/Ack/LKG 闭环                |
| P2         | PostgreSQL Profile 与 Database Provisioner | 按 Provider 自动创建 Runtime DB、Role 和 Migration             |
| P3         | PM2 Runtime Adapter                        | PMS 可自动启动、停止和重启多个 Runtime 进程                    |
| P4         | Provider Package Registry                  | UGV/NPC/HA 作为可展示、可校验的内置包集合                      |
| P5         | Catalog、Registry 与 Console               | Runtime ready 后自动 Discover、Catalog Commit 和 Registry 发布 |
| P6         | 真实 E2E 与发布                            | 离线包基线、PMS、PM2、Runtime、Provider 和 SDAR 端到端验证     |

## **23.1 第一优先交付闭环**

> PMS 发布 OTEL_ENABLED=false  
> → Runtime Watch/Pull  
> → Runtime 安全停用新遥测出口  
> → Task Engine 不受影响  
> → Runtime Ack applied  
> → PMS Console 显示实例已应用

## **23.2 第二优先交付闭环**

> 管理员创建 Provider RuntimeDeployment  
> → 自动创建 Provider Runtime Database  
> → 执行 Runtime Migration  
> → 生成 Secret 文件与 Bootstrap Config  
> → PM2 启动 Runtime  
> → health/ready  
> → server/discover + tools/list  
> → Catalog 与 Registry 发布

# **24 风险、约束与待决策项**

| **编号** | **风险/待决策**                 | **处理建议**                                                           |
|----------|---------------------------------|------------------------------------------------------------------------|
| R1       | 离线包无 Git 历史               | 使用 ZIP SHA、Manifest、SHA256SUMS 和初始 Baseline Commit 建立可追溯性 |
| R2       | Runtime/Provider Migration 混合 | 在任何数据库自动化前先拆分 Migration Set                               |
| R3       | 同 Provider 多副本稳定入口      | 明确 Gateway/Nginx 方案；无稳定入口时限制 desiredReplicas=1            |
| R4       | PM2 Adapter 权限过大            | 固定入口、命名空间、允许列表、最小文件/数据库权限                      |
| R5       | 配置热更新能力被高估            | 每项配置显式 Apply Mode，默认 restart_required 而非假设热更新          |
| R6       | 真实资源资格混淆                | 分开 Component、Mock、Real Resource 和 System Interop 状态             |
| R7       | Provider Adapter 生产管理边界   | vendor_managed 为默认；platform_managed 仅显式选择                     |
| R8       | 数据库切换造成双 Task Authority | 禁止普通 rolling reload；使用受控停机切换流程                          |
| R9       | ClickHouse 直接依赖影响 Task    | 通过 Collector 隔离，Runtime 不直接连接 ClickHouse                     |
| R10      | 现有 Runtime 配置默认值变化     | 共享配置契约抽取时做字节级/行为级回归测试                              |

## **24.1 当前待确认决策**

- V0.1 是否允许同一 Provider desiredReplicas \> 1；如允许，稳定 MCP Gateway 采用何种实现。

- 内置 UGV/NPC/HA 在生产中的默认 hostingMode 是否全部保持 vendor_managed。

- Secret Store 首版采用文件型本地 Store、Vault 还是现有部署系统 Secret。

- PMS 和 Runtime 数据库是否位于同一 PostgreSQL Cluster；本文只要求逻辑与权限隔离。

# **25 验收标准**

1.  目标 Monorepo 可使用 Node 22、pnpm 11 完成安装、构建和基础测试。

2.  离线包来源锁、文件清单和初始 Baseline 报告完整。

3.  现有 Runtime 冻结协议 74/74 不回退。

4.  UGV、NPC Tank、Home Assistant 的现有验证资产可继续执行。

5.  Runtime、UGV、NPC 和 PMS Migration 集合物理分离且各自 Runner 只读取自身目录。

6.  PMS Config Center 支持 Draft、Validate、Publish、Rollback、Watch、Pull、Ack 和 LKG。

7.  Runtime 与 PMS 使用同一共享配置定义，生产安全约束一致。

8.  遥测开关能够在线应用且不影响 Task 执行。

9.  数据库配置变化返回 restart_required，不隐式切换 Task Authority。

10. PM2 Runtime Adapter 能自动创建 Runtime Database、执行 Runtime Migration 并启动 Runtime。

11. 每个 Runtime 具有独立 instanceId、port、PID、日志和健康状态。

12. 同一 Provider 多副本共享同一 Runtime Database。

13. PMS 停机不停止已运行 Runtime 和已有 Task。

14. Provider Adapter 生产环境默认仍由供应商管理。

15. UGV/NPC/HA 可作为 Provider Package 被加载、展示和验证。

16. Operation Catalog 仅由正式 server/discover + tools/list 提交。

17. Registry Snapshot 不包含明文凭据和 Runtime Task 数据。

18. Runtime/Provider 遥测通过 Collector 进入共享 ClickHouse，Runtime 不直接连接 ClickHouse。

19. 所有 PM2、数据库、配置、Catalog 和 Registry 写操作具有审计。

20. 全链路 E2E 和故障测试通过，未伪造真实资源资格或 Interop Certified。

# **附录 A 基线来源映射**

| **设计主题**            | **离线包基线来源**                                                                                | **用途**                            |
|-------------------------|---------------------------------------------------------------------------------------------------|-------------------------------------|
| Runtime 总体设计与职责  | references/SDAR_MCP_Tasks_Runtime_Design_V1.0.md；apps/runtime；packages/task-engine/mcp-protocol | 保留 Runtime 标准语义与非目标       |
| Adapter 协议            | references/SDAR_MCP_Tasks_Adapter_Design_V1.0.md；proto；packages/adapter-protocol                | 供应商 Adapter 与 Runtime 边界      |
| Runtime 配置            | apps/runtime/src/config.ts；docs/operations/configuration.md                                      | 共享配置契约输入                    |
| UGV 配置与能力          | apps/ugv-provider-adapter；reports/ugv-provider-v1                                                | UGV Provider Package 输入           |
| NPC Tank 配置与能力     | apps/npc-tank-provider-adapter；reports/npc-tank-provider-v1                                      | NPC Provider Package 输入           |
| Home Assistant Provider | apps/home-assistant-climate-provider；reports/home-assistant-climate                              | HA Provider Package 输入            |
| Runtime Migration       | migrations/001～023；packages/persistence-postgres/src/migrations.ts                              | Runtime DB 权威                     |
| Provider Migration      | migrations/024_ugv_provider.sql；025_npc_tank_provider.sql；各 Adapter migrate.ts                 | Provider DB 权威与拆分依据          |
| 冻结协议                | protocol/\*；reports/protocol-v1-conformance/runtime.json                                         | 协议锁与 74/74 回归基线             |
| 业务事件与遥测          | docs/architecture/\*；reports/business-events-\*；packages/provider-telemetry                     | Collector/ClickHouse 与配置中心输入 |
| 离线交付边界            | WORK_DELIVERY_MANIFEST.json；WORK_COMPLETION_REPORT.md；SHA256SUMS.txt                            | 来源、测试与环境阻断                |

# **附录 B 关键配置分类**

| **配置类别**        | **示例键**                                         | **默认 Apply Mode**             | **配置目标**                  |
|---------------------|----------------------------------------------------|---------------------------------|-------------------------------|
| Runtime 身份        | PROVIDER_ID、PMS_INSTANCE_ID、PMS_DEPLOYMENT_ID    | immutable                       | runtime_deployment / instance |
| Runtime 数据库      | DATABASE_URL_FILE、DATABASE_POOL_MAX               | restart_required                | runtime_deployment            |
| Adapter 连接        | ADAPTER_ENDPOINT、ADAPTER_TLS\_\*                  | restart_required                | runtime_deployment            |
| OTLP                | OTEL_ENABLED、OTEL_EXPORTER_OTLP\_\*               | hot_reload / reconnect_required | provider / deployment         |
| Provider Telemetry  | PROVIDER_TELEMETRY\_\*                             | hot_reload / restart_required   | deployment                    |
| Business Events     | BUSINESS_EVENTS\_\*                                | hot_reload / restart_required   | provider / deployment         |
| Worker              | SCHEDULER\_\*、RECOVERY\_\*、COMMAND\_\*、TTL\_\*  | hot_reload 或 restart_required  | deployment                    |
| UGV                 | UGV_MQTT\_\*、UGV_DEVICE_MCP\_\*、Freshness/Safety | provider-specific               | provider                      |
| NPC Tank            | NPC_TANK_MQTT\_\*、DEVICE_MCP\_\*、Capability      | provider-specific               | provider                      |
| Home Assistant      | HOME_ASSISTANT\_\*、CLIMATE_RESOURCES_FILE         | provider-specific               | provider                      |
| ClickHouse Exporter | endpoint/database/table/credentialRef/batch        | collector hot_reload            | collector                     |

# **附录 C 术语**

| **术语**                | **定义**                                                                    |
|-------------------------|-----------------------------------------------------------------------------|
| PMS                     | Provider Management Service，本平台控制面。                                 |
| MCP Tasks Runtime       | 统一实现 MCP Tasks、Task Authority、调度、恢复和 Adapter 调用的标准运行时。 |
| Provider Adapter        | 供应商侧设备接入、资源事实和 Operation 真实执行实现。                       |
| Provider Package        | 描述 Adapter 入口、配置、Migration、兼容版本和资格状态的可管理包定义。      |
| RuntimeDeployment       | PMS 中某逻辑 Provider 的 Runtime 期望状态聚合。                             |
| RuntimeProcess          | 某个实际 PM2 Runtime 进程的状态投影。                                       |
| Task Authority          | Runtime PostgreSQL 中 Task、Command、Scheduler、Recovery 等权威状态集合。   |
| LKG                     | Last Known Good，Runtime 本地最后一次成功应用的配置。                       |
| Component Conformant    | 单组件适用协议与测试门禁通过。                                              |
| Real Resource Qualified | 经过真实外部资源/设备验证，不能由 Mock 结果替代。                           |

— 文档结束 —
