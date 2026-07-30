# PMS Console API Contract V1.0 协议冻结规范

## SMPP 既有业务零影响版

## 1. 任务目标

完成：

```text
PMS Console API Contract V1.0
Status: Contract Frozen
```

该合同只允许暴露 SMPP 当前 `main` 已经存在的：

* 领域对象；
  -应用服务；
  -查询能力；
  -命令能力；
  -持久化状态；
  -错误语义；
  -作业与审计信息。

合同不得：

* 创造新的业务对象；
  -创造新的状态机；
  -增加新的业务命令；
  -改变现有事务边界；
  -改变现有对象生命周期；
  -增加数据库表或字段；
  -改变 Worker 调度行为；
  -改变 Runtime、Provider 或 Registry 权威关系。

本任务是**协议冻结任务**，不是 PMS API 实现任务，也不是 PMS Web 真实接口接入任务。

---

# 2. 核心原则

## 2.1 Console API 是适配层，不是业务层

正式关系：

```text
PMS Web
   ↓
PMS Console API Contract
   ↓
Console API Adapter（后续实现）
   ↓
现有 PMS Application Service / Query Port
   ↓
现有 SMPP Domain / Persistence / Worker
```

禁止：

```text
Console 页面需求
→ 新建业务对象
→ 新建 Application Service
→ 修改 SMPP 业务流程
```

允许：

```text
现有业务对象
→ DTO 投影
→ Console API
→ Web ViewModel
```

---

## 2.2 每个接口必须有既有能力证据

每个冻结 Endpoint 必须能回答：

```text
对应哪个现有对象？
对应哪个现有 Application Port？
对应哪个现有 Query/Repository？
对应哪个现有命令？
当前有哪些业务副作用？
当前有哪些错误码？
是否已在生产路径使用？
```

任何一个问题无法回答：

```text
该 Endpoint 不得进入 V1 Frozen Contract
```

---

## 2.3 禁止通过合同倒逼业务开发

以下理由不能成为冻结接口的依据：

```text
前端页面已经设计了
Mock Gateway 已经有该方法
用户体验需要该对象
这样接口更统一
未来可能需要
```

只有以下依据有效：

```text
main 已存在对应领域对象
main 已存在对应查询能力
main 已存在对应命令或应用服务
main 已存在可稳定投影的数据
```

---

# 3. 执行基线

任务开始时执行：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git rev-parse HEAD
git status --short
```

记录：

```text
PMS_CONSOLE_CONTRACT_BASELINE_COMMIT
```

创建分支：

```text
codex/goal-06-pms-console-api-contract-v1
```

生成：

```text
contracts/pms-console-api/v1/BASELINE.json
```

内容至少包括：

```json
{
  "repository": "zhouwen-giser/sdar-mcp-provider-platform",
  "branch": "main",
  "baselineCommit": "<sha>",
  "capturedAt": "<rfc3339>",
  "platformVersion": "0.1.0"
}
```

合同冻结后，Baseline Commit 不得继续移动。

---

# 4. 允许修改范围

只允许修改或新增：

```text
contracts/pms-console-api/**
packages/pms-console-api-contract/**
packages/pms-console-api-testkit/**
scripts/pms-console-contract/**
docs/adr/*pms-console*
docs/review/PMS_CONSOLE_API_*
package.json
pnpm-lock.yaml
前述新 Package 必需的 tsconfig/project references
```

`package.json` 和锁文件只允许增加：

* OpenAPI 校验工具；
  -Contract Package；
  -合同验证脚本；
  -合同测试命令。

---

# 5. 禁止修改范围

本任务禁止修改：

```text
apps/pms-api/src/**
apps/pms-worker/**
apps/runtime/**
apps/pms-web/src/features/**
apps/pms-web/src/gateways/**
packages/pms-domain/**
packages/pms-application/**
packages/pms-persistence-postgres/**
packages/runtime-deployment/**
packages/runtime-registration/**
packages/configuration-center/**
packages/catalog-manager/**
packages/registry-snapshot/**
packages/pm2-runtime-adapter/**
migrations/**
protocol/**
provider-packages/**
```

也禁止修改现有：

```text
生产路由
领域枚举
应用服务接口
Repository 接口
数据库 Schema
Worker Job 类型
Runtime 状态机
Catalog/Registry 发布逻辑
```

---

# 6. SMPP 业务不变性证明

任务开始时对以下目录建立 Hash 清单：

```text
apps/pms-api/src
apps/pms-worker/src
packages/pms-domain/src
packages/pms-application/src
packages/pms-persistence-postgres/src
packages/runtime-deployment/src
packages/runtime-registration/src
packages/configuration-center/src
packages/catalog-manager/src
packages/registry-snapshot/src
migrations
protocol
```

生成：

```text
contracts/pms-console-api/v1/business-baseline.sha256
```

冻结前再次计算：

```text
contracts/pms-console-api/v1/business-final.sha256
```

两份内容必须完全一致。

验证命令：

```bash
diff \
  contracts/pms-console-api/v1/business-baseline.sha256 \
  contracts/pms-console-api/v1/business-final.sha256
```

结果不一致：

```text
合同不得标记 Frozen
```

---

# 7. 对象与能力盘点

必须先生成：

```text
contracts/pms-console-api/v1/
├── EXISTING_OBJECT_INVENTORY.md
├── EXISTING_CAPABILITY_MATRIX.md
├── EXISTING_ROUTE_INVENTORY.md
├── WEB_GATEWAY_DEMAND_MATRIX.md
└── DEFERRED_SURFACES.md
```

## 7.1 对象清单要求

每个对象记录：

```text
对象名称
领域定义文件
持久化表或来源
Application Service
Query Port
当前 API Route
支持的命令
状态枚举
Revision/并发字段
主要错误码
```

## 7.2 能力分类

每项能力必须标记为以下之一：

```text
EXISTING_QUERY
EXISTING_COMMAND
READ_ONLY_PROJECTION
WEB_DERIVED
DEFERRED
FORBIDDEN
```

### EXISTING_QUERY

已有正式查询 Port、Repository 或 API。

可以冻结。

### EXISTING_COMMAND

已有正式 Application Service 或领域命令。

可以冻结，但语义必须完全保持不变。

### READ_ONLY_PROJECTION

只组合现有对象和字段，不持久化新状态，不产生副作用。

可以冻结，但必须列出每个字段的数据来源。

### WEB_DERIVED

应由前端基于多个现有接口计算的显示信息。

不得单独创造后端业务接口。

### DEFERRED

当前 SMPP 没有对应对象或能力。

保留页面，不进入 V1 Contract。

### FORBIDDEN

违反控制面边界或会改变业务权威。

禁止进入任何 Console 合同。

---

# 8. V1 可冻结对象范围

以下是允许进入审计和冻结候选的对象。

最终是否进入 OpenAPI，仍以代码证据为准。

## 8.1 Provider Type

允许：

```text
查询列表
查询详情
```

不得新增：

```text
Provider Type 在线编辑
动态修改领域类型
修改已发布 Package 与 Type 的绑定语义
```

---

## 8.2 Provider Package

允许：

```text
查询 Package
查询 Package 版本
查询 Package Metadata
```

只有现有正式命令存在时，才能暴露对应写操作。

不得为了 Console 新增：

```text
浏览器上传 Package
浏览器编辑 Package
浏览器修改 Package Schema
```

---

## 8.3 Provider

允许冻结现有：

```text
创建 Provider
查询 Provider
列出 Provider
执行现有状态转换
```

不得新增通用：

```text
PATCH 任意 Provider 字段
Provider Onboarding 一键事务
Provider Preflight 业务流程
Provider 自动修复
```

Provider 接入向导必须在 Web 端组合已有调用，不能创造一个新的：

```text
POST /provider-onboarding
```

---

## 8.4 Resource

允许：

```text
查询列表
查询详情
按 Provider 查询
```

只有当前存在正式 Resource 写服务时，才允许写接口进入合同。

不得让 PMS Console 成为设备实时状态权威。

---

## 8.5 Database Profile

允许：

```text
只读列表
只读详情
只读状态和 SecretRef Metadata
```

只有当前存在正式 Management Application Service 时，才能冻结创建或更新接口。

不得在合同中返回：

```text
数据库密码
带凭据的 Database URL
管理 Credential 内容
```

---

## 8.6 Configuration

必须使用 SMPP 已有名词，优先围绕：

```text
Configuration Definition
Configuration Draft
Configuration Target
Configuration Publication
Published Revision
Effective Configuration
Runtime Configuration Ack
```

不得把前端原型中的：

```text
ConfigurationProfile
```

直接认定为新的业务对象。

允许冻结当前已有：

```text
创建 Draft
查询 Draft
校验 Draft
发布 Draft
查询 Published Revision
查询 Effective Configuration
查询 Runtime Ack
```

以下行为只有现有业务支持时才能进入：

```text
编辑 Draft
回滚
重新发布
```

不得新增审批流、变更单或配置部署状态机。

---

## 8.7 RuntimeDeployment

允许冻结已有：

```text
创建
查询详情
查询列表
start
stop
restart
scale
reconcile
```

只能使用当前领域已经支持的命令。

不得新增：

```text
upgrade
pause
resume
move
canary
batch rollout
```

除非 `main` 已经有对应领域命令和 Application Service。

---

## 8.8 RuntimeProcess

允许：

```text
查询列表
查询详情
按 Deployment 查询
```

只投影已有：

```text
processState
livenessState
readinessState
registrationState
registrationFreshness
catalogState
runtimeVersion
configRevision
observedRevision
restartCount
lastHeartbeatAt
```

不得新增独立 RuntimeProcess 控制命令。

Runtime 操作必须继续通过 RuntimeDeployment 现有命令执行。

---

## 8.9 Catalog

只允许基于现有 Catalog Snapshot、Catalog Entry 和发现结果开放只读接口。

允许：

```text
查询当前 Catalog
按 Provider 查询
查询历史或 Revision（仅当前已有时）
查看 Tool Schema
```

不得新增：

```text
手工编辑 Catalog
手工新增 Operation
手工删除 Operation
block/unblock Catalog
管理员确认 Breaking Change
```

如果当前 Catalog Rediscover 只能由 Reconcile 流程触发，则 Console 只能调用既有：

```text
RuntimeDeployment reconcile
```

不得新增独立 Rediscover 业务命令。

---

## 8.10 Registry

允许冻结现有：

```text
Latest
History
Revision Detail
Diff
```

Registry 仍由现有 Catalog/Registry 收口流程产生。

不得新增：

```text
手工编辑 Registry
手工构造 Snapshot
任意发布 Registry Document
```

只有当前已存在正式发布命令时，才允许暴露 publish。

---

## 8.11 Worker Job

允许：

```text
查询列表
查询详情
查询状态、Attempt、Lease、Fence 和错误摘要
```

以下动作只有当前存在正式管理服务时才能冻结：

```text
requeue
cancel
release
```

禁止：

```text
手工标记成功
修改 Fence
修改 Lease Owner
直接改变 Job Payload
```

---

## 8.12 Audit

允许：

```text
查询列表
查询详情
按 Subject、Correlation ID、Actor 和时间筛选
```

Audit 只读。

不得提供：

```text
修改
删除
重写
补录成功结果
```

---

# 9. 不得进入 V1 Contract 的对象

当前原型页面存在，但如果 SMPP `main` 没有对应正式对象或 Application Service，则必须标记为：

```text
CONTRACT_DEFERRED
```

默认延后：

```text
Dashboard 聚合对象
Attention Center
Notification
Global Search
Generic Operation
Incident
Incident Rule
Change Request
Approval
Change Calendar
Conformance Run 管理
MCP Explorer 历史
User
Role
Service Account
Access Review
System Setting
Secret 管理
Runtime Release 管理
Catalog Block/Unblock
Registry 人工发布
```

其中：

## Generic Operation

前端 `PrototypeOperation` 是 UI 交互模型，不得成为新的 SMPP 业务对象。

Console 命令响应应返回当前业务已经产生的：

```text
资源 Snapshot
Job ID
Job Snapshot
当前命令结果
```

不能为了匹配 Operation Panel 新增：

```text
operation 表
operation 状态机
operation worker
operation audit 模型
```

Operation Panel 后续应通过已有 RuntimeDeployment 和 Job 状态组合展示。

## Incident

当前前端 Incident 为原型对象。

在 SMPP 没有正式 Incident Domain 前：

```text
Incident API 不得冻结
```

页面可以继续使用 Mock 或标记 Deferred。

## Change Request

没有现有审批和变更管理业务时：

```text
Change Request API 不得冻结
```

---

# 10. 不得创造 Environment 业务对象

如果 SMPP 当前只把 `environment` 作为现有资源字段或配置定位字段，则合同不得新增：

```text
Environment Entity
Environment Lifecycle
Environment Settings
Environment Management API
```

允许：

```text
在现有支持 environment 的查询中使用 query 参数
在已有对象 DTO 中返回 environment 字段
```

不得强制所有对象采用：

```text
/environments/{environmentId}/...
```

只有当当前对象本身确实具有 Environment Scope 时，才可使用该路径层级。

Provider、Package 等全局对象不得被人为挂到 Environment 下。

---

# 11. API 路径原则

新合同使用：

```text
/api/console/v1
```

这是新传输适配层，不替换现有：

```text
/api/v1/**
```

合同冻结任务不实现新 Route。

后续实现时：

```text
/api/console/v1
→ 委托已有 Application/Query Port
```

不得：

```text
删除现有 API
改变现有 API 行为
改变 Runtime 机器接口
复用 Runtime Token 认证
```

---

# 12. Endpoint 进入合同的强制证据

每个 OpenAPI Operation 必须在：

```text
contracts/pms-console-api/v1/ENDPOINT_SOURCE_MAP.json
```

中提供：

```json
{
  "operationId": "listProviders",
  "classification": "EXISTING_QUERY",
  "domainObject": "Provider",
  "sourceFiles": [
    "packages/...",
    "apps/pms-api/..."
  ],
  "sourcePort": "ProviderManagementPort.list",
  "currentRoute": "/api/v1/providers",
  "businessSideEffects": [],
  "newBusinessBehavior": false
}
```

写接口还必须包含：

```json
{
  "existingCommand": "ProviderManagementService.create",
  "existingTransactionBoundary": "unchanged",
  "existingAuditAction": "provider.created",
  "existingJobType": null
}
```

缺少 Source Map 的 Operation：

```text
OpenAPI 校验必须失败
```

---

# 13. DTO 规则

## 13.1 字段来源

每个 DTO 字段必须属于：

```text
DOMAIN_FIELD
PERSISTED_FIELD
EXISTING_DERIVED_FIELD
TRANSPORT_METADATA
```

允许的 Transport Metadata：

```text
requestId
correlationId
pageInfo
links
```

不得加入没有来源的：

```text
displayStatus
recommendedAction
riskLevel
attentionState
incidentState
approvalState
```

这些可作为前端 ViewModel。

## 13.2 枚举

OpenAPI 中的业务枚举必须逐字复用现有领域枚举。

禁止：

```text
合并多个领域状态为 EntityStatus
重新命名状态
增加 UI 友好状态
缩小现有状态集合
```

## 13.3 Revision

只在当前对象已有 Revision、Observed Revision 或稳定并发字段时暴露。

不得为了统一接口给所有对象虚构：

```text
revision
```

对象使用 `updatedAt` 并发控制时，合同必须如实描述现状。

协议冻结任务不得改变业务并发机制。

---

# 14. 并发和幂等规则

上一版“所有资源统一 ETag”和“所有命令统一 Idempotency-Key”的要求取消。

新原则：

```text
只冻结已有并发和幂等语义
```

## 14.1 并发

如果现有服务使用：

```text
expectedUpdatedAt
expectedRevision
observedRevision
fencingToken
```

Console Contract 必须保留对应语义。

不得为了接口统一而修改 Application Service。

## 14.2 幂等

只有现有命令已经具备稳定幂等机制时，合同才能声明支持：

```text
Idempotency-Key
```

否则不得在 V1 中做虚假承诺。

---

# 15. 分页规则

不能为了统一而修改现有 Repository 或查询算法。

处理方式：

```text
当前 Query 已支持 Cursor
→ 合同复用 Cursor

当前 Query 已支持 Limit/Cursor
→ 合同如实冻结

当前 Query 只支持有限列表
→ 合同冻结其现有边界

当前 Query 无安全分页能力
→ Endpoint 延后或明确最大集合边界
```

不得为了冻结协议修改数据库查询行为。

---

# 16. 错误协议

Console 适配层可以统一传输错误格式：

```text
application/problem+json
```

但错误语义必须映射已有错误码。

允许：

```text
现有 Domain/Application Error
→ Console ProblemDetails
```

禁止：

```text
为前端新增业务错误码
把多个不同业务错误合并
改变 retryable 语义
改变 HTTP 成功/失败语义
```

生成：

```text
ERROR_SOURCE_MAP.json
```

每个 Problem Code 必须映射到现有错误类或错误码。

无法映射的错误：

```text
不得进入 ERROR_CATALOG.md
```

---

# 17. 写操作约束

每个 Console 写接口只能：

```text
调用一个现有 Application Command
```

不得在 Console Adapter 中执行：

```text
创建 Provider
→ 创建配置
→ 创建数据库
→ 创建 Deployment
```

这种多步业务编排。

所以：

```text
Provider Onboarding
Runtime 创建向导
配置发布向导
故障恢复流程
```

仍由 Web 调用多个现有接口完成。

Console API 不新增“一键完成”事务。

---

# 18. Read Model 约束

允许构建只读 DTO，但必须满足：

```text
所有字段来源于现有查询
不写数据库
不增加缓存权威
不增加状态机
不改变现有对象状态
```

Read Model 只能用于减少前端字段拼接。

不允许 Read Model：

```text
形成新的持久化对象
成为新业务权威
产生新的业务状态
触发后台任务
```

Dashboard 默认由前端调用现有列表接口聚合。

除非代码审计证明 SMPP 已存在正式 Dashboard Query，否则不冻结 Dashboard Endpoint。

---

# 19. OpenAPI 文件结构

```text
contracts/pms-console-api/v1/
├── openapi.yaml
├── CONTRACT.md
├── BASELINE.json
├── EXISTING_OBJECT_INVENTORY.md
├── EXISTING_CAPABILITY_MATRIX.md
├── EXISTING_ROUTE_INVENTORY.md
├── ENDPOINT_SOURCE_MAP.json
├── ERROR_SOURCE_MAP.json
├── WEB_API_MAPPING.md
├── DEFERRED_SURFACES.md
├── NON_IMPACT_PROOF.md
├── CHANGE_POLICY.md
├── examples/
├── schemas/
├── conformance-cases/
├── business-baseline.sha256
├── business-final.sha256
└── contract-lock.json
```

---

# 20. WEB_API_MAPPING 要求

对当前九组 Gateway 逐项标记：

```text
FROZEN_API
WEB_COMPOSED
MOCK_DEFERRED
FORBIDDEN
```

例如：

```text
ProviderGateway.providers
→ FROZEN_API

ProviderGateway.onboardProvider
→ WEB_COMPOSED
→ 使用 Provider Create + 现有其他接口
→ 不新增 onboard endpoint

OperationsGateway.startOperation
→ MOCK_DEFERRED
→ Generic Operation 不存在

OperationsGateway.closeIncident
→ MOCK_DEFERRED
→ Incident Domain 不存在
```

PMS Web 当前类型不得直接复制到 OpenAPI。

---

# 21. Contract Package

允许创建：

```text
packages/pms-console-api-contract
```

该 Package 只能包含：

```text
生成的 TypeScript DTO
OpenAPI Schema Bundle
ProblemDetails 类型
编解码和验证函数
合同版本常量
```

禁止依赖：

```text
PMS Domain
PMS Application
PMS Persistence
Worker
Runtime
PM2
```

Contract Package 不得包含业务实现。

---

# 22. 合同测试

## 22.1 静态检查

必须验证：

```text
OpenAPI lint
OpenAPI bundle
所有 $ref 可解析
operationId 唯一
示例符合 Schema
枚举有来源
错误码有来源
Endpoint 有来源
无 TODO/TBD
```

## 22.2 业务影响检查

必须验证：

```text
业务目录 Hash 未变化
Migration Hash 未变化
Protocol Hash 未变化
生产 Route 未变化
领域枚举未变化
Application Port 未变化
Repository Port 未变化
Worker Job Type 未变化
```

## 22.3 新业务名词检查

建立允许的 Transport 名词白名单：

```text
ProblemDetails
PageInfo
RequestMetadata
CorrelationMetadata
```

OpenAPI 中出现其他新业务对象名时，必须能够映射到 `EXISTING_OBJECT_INVENTORY.md`。

否则校验失败。

## 22.4 写接口检查

每个：

```text
POST
PUT
PATCH
DELETE
```

必须在 Source Map 中指向现有 Application Command。

不得只指向 Repository。

不得直接指向 SQL。

---

# 23. 冻结条件

只有全部满足，才允许：

```text
Contract Frozen
```

1. Baseline 固定为任务开始时最新 `main`；
   2.业务目录 Hash 前后一致；
   3.无 Migration 修改；
   4.无 Protocol 修改；
   5.无生产代码修改；
   6.每个 Endpoint 有现有对象或能力来源；
   7.每个写接口映射现有 Application Command；
   8.没有新增业务对象；
   9.没有新增业务命令；
   10.没有新增状态枚举；
   11.没有新增事务或编排；
   12.没有 Generic Operation API；
   13.没有 Incident API；
   14.没有 Change Request API；
   15.前端未支持页面已标记 Deferred；
   16.所有 DTO 字段有来源；
   17.所有错误码有来源；
   18.OpenAPI、Schema 和示例全部通过；
   19.无 TODO/TBD；
   20.Contract Breaking Baseline 已生成；
   21.Contract Lock 已生成；
   22.NON_IMPACT_PROOF.md 完整；
   23.合同评审通过。

---

# 24. Contract Lock

```json
{
  "contract": "pms-console-api",
  "version": "1.0.0",
  "status": "frozen",
  "baselineCommit": "<main-sha>",
  "openApiSha256": "<sha256>",
  "schemaBundleSha256": "<sha256>",
  "endpointSourceMapSha256": "<sha256>",
  "businessSourceSha256": "<sha256>",
  "businessSourceUnchanged": true,
  "migrationsUnchanged": true,
  "protocolUnchanged": true,
  "frozenAt": "<rfc3339>"
}
```

---

# 25. 任务拆分建议

## P0：基线与业务盘点

```text
固定 main SHA
建立业务 Hash
盘点现有对象
盘点现有 Query/Command
盘点现有 Route/Error
```

## P1：冻结候选范围

```text
对象能力矩阵
前端 Gateway 差距矩阵
冻结/延后/禁止分类
Endpoint Source Map
```

## P2：合同编写

```text
OpenAPI
Schema
Examples
ProblemDetails
Error Source Map
```

## P3：合同验证

```text
生成 Contract Package
静态合同测试
新业务对象检查
写接口命令来源检查
业务 Hash 检查
Breaking Baseline
```

## P4：冻结

```text
清除全部 TODO/TBD
生成 NON_IMPACT_PROOF
生成 Contract Lock
状态改为 Frozen
输出 Handoff
```

---

# 26. 最终交付

必须交付：

```text
contracts/pms-console-api/v1/**
packages/pms-console-api-contract/**
packages/pms-console-api-testkit/**
docs/review/PMS_CONSOLE_API_CONTRACT_V1_REVIEW.md
docs/review/PMS_CONSOLE_API_CONTRACT_V1_HANDOFF.md
reports/pms-console-api-contract-v1/TEST_EVIDENCE.json
```

最终报告必须明确列出：

```text
已冻结 Endpoint
已延后 Endpoint
禁止开放的 Endpoint
现有对象映射
现有命令映射
前端 Gateway 映射
业务未变证明
下一阶段 API 实现范围
下一阶段 Web 接入范围
```

本任务完成后停止。

不得继续实现 `/api/console/v1` Route，不得修改 PMS Web Gateway，不得接入真实 API。
