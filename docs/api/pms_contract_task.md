# ChatGPT Work 任务指令

# PMS Console API Contract V1.0 协议制定与冻结

## 一、任务名称

```text
PMS Console API Contract V1.0 Freeze
```

## 二、工作仓库

```text
zhouwen-giser/sdar-mcp-provider-platform
```

目标分支：

```text
main
```

工作分支建议：

```text
codex/goal-06-pms-console-api-contract-v1
```

补充输入材料：

```text
pms-web-productionization-foundation.zip
```

该 ZIP 只用于分析 PMS Web 当前的：

* Gateway；
  -ViewModel；
  -页面数据需求；
  -交互流程；
  -Mock 场景；
  -Deferred 页面。

GitHub 仓库最新 `main` 是 SMPP 业务事实的唯一权威。

---

# 三、任务目标

基于 SMPP 最新 `main` 中已经存在的领域对象、应用服务、查询能力、命令能力、持久化对象、状态枚举和错误语义，完成：

```text
PMS Console API Contract V1.0
Status: Contract Frozen
```

交付内容必须包括：

```text
OpenAPI
JSON Schema
Endpoint Source Map
Error Source Map
对象与能力清单
PMS Web 映射
示例
合同验证脚本
Breaking Change 基线
Contract Lock
业务零影响证明
测试证据
最终交付 ZIP
```

本任务只制定和冻结接口合同。

本任务不得实现：

```text
/api/console/v1
```

正式业务路由，不得让 PMS Web 接入真实 PMS API。

---

# 四、最高优先级约束

## 4.1 只能开放现有能力

所有进入 V1 Frozen Contract 的接口必须映射到 SMPP `main` 中已经存在的：

```text
领域对象
Application Service
Query Port
Repository Query
现有 API Route
现有业务命令
现有状态枚举
现有错误码
```

不得因为以下原因创建接口：

```text
前端页面需要
原型中已经存在
Mock Gateway 已定义
用户体验更完整
未来可能需要
接口看起来更统一
```

任何接口无法找到现有能力来源时，必须标记：

```text
CONTRACT_DEFERRED
```

或者：

```text
FORBIDDEN
```

不得通过修改 SMPP 业务代码补齐。

---

## 4.2 不得影响 SMPP 业务

禁止修改：

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

不得改变：

```text
领域对象
领域枚举
Application Port
Repository Port
数据库结构
Migration
Worker Job Type
Worker 调度
RuntimeDeployment 状态机
Runtime 注册
配置发布流程
Catalog 发现流程
Registry 发布流程
审计语义
现有生产 API 行为
```

---

## 4.3 不得创造 Console 专属业务层

禁止新增：

```text
Generic Operation 领域对象
Operation 数据表
Operation Worker
Incident 领域对象
Change Request
Approval
Environment Entity
Dashboard Domain
Notification Domain
Global Search Domain
Catalog Block/Unblock 状态
Registry 人工编辑流程
Provider Onboarding 一键业务事务
```

Console API 只能作为现有 SMPP 能力的传输适配层。

---

# 五、执行基线

任务开始后立即执行：

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

工作区必须干净。

将结果记录为：

```text
PMS_CONSOLE_CONTRACT_BASELINE_COMMIT
```

创建分支：

```bash
git switch -c codex/goal-06-pms-console-api-contract-v1
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
  "baselineCommit": "<40-character-sha>",
  "capturedAt": "<RFC3339>",
  "platformVersion": "<detected-version>"
}
```

基线建立后，不允许在任务过程中继续追踪移动的 `main`。

---

# 六、第一阶段：SMPP 现状审计

在编写 OpenAPI 前，必须完整审计。

## 6.1 审计范围

至少审计：

```text
apps/pms-api/src/**
apps/pms-api/test/**
apps/pms-worker/src/**
packages/pms-domain/src/**
packages/pms-application/src/**
packages/pms-persistence-postgres/src/**
packages/configuration-center/src/**
packages/runtime-deployment/src/**
packages/runtime-registration/src/**
packages/catalog-manager/src/**
packages/registry-snapshot/src/**
packages/provider-package-registry/src/**
migrations/pms/**
docs/operations/**
docs/adr/**
```

同时审计补充 ZIP 中的：

```text
apps/pms-web/src/gateways/**
apps/pms-web/src/features/**
apps/pms-web/src/data/**
apps/pms-web/src/prototype/**
docs/design/**
```

如果 ZIP 中的内容已经存在于仓库，优先使用仓库版本。

---

## 6.2 必须生成的审计文件

```text
contracts/pms-console-api/v1/
├── EXISTING_OBJECT_INVENTORY.md
├── EXISTING_CAPABILITY_MATRIX.md
├── EXISTING_ROUTE_INVENTORY.md
├── EXISTING_ERROR_INVENTORY.md
├── EXISTING_ENUM_INVENTORY.md
├── WEB_GATEWAY_DEMAND_MATRIX.md
└── DEFERRED_SURFACES.md
```

---

## 6.3 对象清单内容

每个对象必须记录：

```text
对象名称
领域定义位置
持久化来源
Application Service
Query Port
Repository Port
现有 API Route
已有命令
已有状态枚举
并发控制方式
审计行为
主要错误码
是否适合 Console 开放
```

---

## 6.4 能力分类

所有能力必须分类为：

```text
EXISTING_QUERY
EXISTING_COMMAND
READ_ONLY_PROJECTION
WEB_COMPOSED
CONTRACT_DEFERRED
FORBIDDEN
```

### EXISTING_QUERY

存在正式 Query/Application/Repository 查询能力。

可以进入冻结候选。

### EXISTING_COMMAND

存在正式 Application Command，且业务语义稳定。

可以进入冻结候选。

### READ_ONLY_PROJECTION

只投影现有字段：

```text
不写数据库
不创建状态
不触发 Job
不改变事务边界
```

可以进入候选，但每个字段必须标明来源。

### WEB_COMPOSED

应由 PMS Web 调用多个现有接口完成。

不得为其创建一键业务接口。

### CONTRACT_DEFERRED

SMPP 当前没有正式对象或能力。

不得进入 V1 Contract。

### FORBIDDEN

会突破 SMPP 权威边界或修改业务语义。

禁止开放。

---

# 七、第二阶段：确定合同冻结范围

## 7.1 允许进入候选的领域

以下对象可以审计，但最终只有存在代码证据时才能进入合同：

```text
Provider Type
Provider Package
Provider
Resource
Database Profile
Configuration Definition
Configuration Draft
Configuration Publication
Published Configuration Revision
Effective Configuration
Runtime Configuration Ack
RuntimeDeployment
RuntimeProcess
Catalog Snapshot
Catalog Entry
Registry Snapshot
Job Lease / Worker Job
Audit Event
```

---

## 7.2 默认延后的领域

如果 SMPP 当前没有正式对象或 Application Service，必须延后：

```text
Dashboard API
Generic Operation API
Incident API
Change Request API
Approval API
Change Calendar
Notification API
Global Search API
Conformance Run 管理
MCP Explorer 历史
User 管理
Role 管理
Service Account 管理
Access Review
System Setting 管理
Secret 值管理
Runtime Release 写管理
Database Profile 写管理
Catalog Block/Unblock
Registry 人工编辑或人工发布
```

不得为了满足前端原型而恢复这些接口。

---

## 7.3 Provider 约束

允许审计和冻结已有：

```text
创建 Provider
查询 Provider
列出 Provider
现有状态转换
```

禁止新增：

```text
POST /provider-onboarding
POST /provider-preflight
PATCH 任意 Provider 字段
Provider 自动修复
一键创建 Provider + Config + Database + RuntimeDeployment
```

接入向导应标记为：

```text
WEB_COMPOSED
```

---

## 7.4 RuntimeDeployment 约束

只允许冻结 SMPP 已有命令。

可能包括：

```text
create
list
get
start
stop
restart
scale
reconcile
```

必须通过代码确认。

以下命令不得预设：

```text
upgrade
pause
resume
canary
move
batch rollout
```

除非最新 `main` 已有对应正式业务能力。

---

## 7.5 Configuration 约束

必须复用 SMPP 已有对象名称。

不得直接把前端原型中的：

```text
ConfigurationProfile
```

认定为 SMPP 业务对象。

只允许冻结代码中存在的：

```text
Definition
Draft
Target
Publication
Revision
Effective Configuration
Runtime Ack
```

不得新增：

```text
配置审批流
Change Request
配置部署状态机
新的回滚语义
```

---

## 7.6 RuntimeProcess 约束

RuntimeProcess 默认只读。

只能投影 SMPP 已有字段，例如：

```text
processState
livenessState
readinessState
registrationState
catalogState
runtimeVersion
configRevision
restartCount
lastHeartbeatAt
```

不得新增：

```text
直接启动单个 RuntimeProcess
直接停止单个 RuntimeProcess
直接执行 PM2 命令
```

控制操作仍应通过现有 RuntimeDeployment 命令完成。

---

## 7.7 Catalog 与 Registry 约束

Catalog 和 Registry 必须保持现有权威关系。

允许只读开放：

```text
current
latest
history
revision detail
entry detail
diff（仅已有实现时）
```

禁止：

```text
手工编辑 Catalog
手工新增 Tool
手工删除 Tool
手工修改 Registry Document
伪造 Snapshot
新建 block/unblock 状态
```

如果 Rediscover 只能由 RuntimeDeployment Reconcile 触发，则不得新增独立 Rediscover 命令。

---

## 7.8 Worker Job 约束

默认只允许：

```text
list
get
查看状态
查看 attempt
查看 lease
查看 fencing token
查看错误摘要
```

只有存在正式管理 Application Service 时，才允许：

```text
requeue
cancel
release
```

禁止：

```text
mark succeeded
修改 fence
修改 owner
修改 payload
```

---

## 7.9 Audit 约束

Audit 完全只读。

允许：

```text
list
get
按 subject 查询
按 actor 查询
按 correlationId 查询
按时间查询
```

禁止修改、删除和补录。

---

# 八、Endpoint Source Map

每个进入 OpenAPI 的 Operation 必须在：

```text
contracts/pms-console-api/v1/ENDPOINT_SOURCE_MAP.json
```

中拥有记录。

示例：

```json
{
  "operationId": "listProviders",
  "classification": "EXISTING_QUERY",
  "domainObject": "Provider",
  "sourceFiles": [
    "packages/pms-application/src/...",
    "apps/pms-api/src/..."
  ],
  "sourcePort": "ProviderManagementPort.list",
  "currentRoute": "/api/v1/providers",
  "businessSideEffects": [],
  "newBusinessBehavior": false
}
```

写操作还必须包含：

```json
{
  "existingCommand": "ProviderManagementService.create",
  "existingTransactionBoundary": "unchanged",
  "existingAuditAction": "provider.created",
  "existingJobType": null
}
```

规则：

```text
没有 Endpoint Source Map
→ 不得进入 OpenAPI

只映射到 Repository
→ 写接口不得进入 OpenAPI

只映射到 SQL
→ 写接口不得进入 OpenAPI

要求新增 Application Service
→ 标记 CONTRACT_DEFERRED
```

---

# 九、Error Source Map

生成：

```text
contracts/pms-console-api/v1/ERROR_SOURCE_MAP.json
```

每个 Console Problem Code 必须映射现有：

```text
Domain Error
Application Error
Repository Error
已有稳定错误码
```

允许统一传输格式：

```text
application/problem+json
```

但不得：

```text
新增业务错误语义
合并含义不同的错误
修改 retryable 属性
修改成功或失败判断
```

示例：

```json
{
  "problemCode": "PROVIDER_NOT_FOUND",
  "sourceCode": "PROVIDER_NOT_FOUND",
  "sourceFiles": [
    "packages/pms-application/src/..."
  ],
  "httpStatus": 404,
  "semanticChange": false
}
```

无法映射的错误不得进入 Error Catalog。

---

# 十、DTO 制定规则

## 10.1 DTO 字段来源

每个字段必须标记为：

```text
DOMAIN_FIELD
PERSISTED_FIELD
EXISTING_DERIVED_FIELD
TRANSPORT_METADATA
```

只允许以下 Transport Metadata：

```text
requestId
correlationId
pageInfo
links
```

不得在 API DTO 中增加：

```text
displayStatus
recommendedAction
attentionState
riskLevel
incidentState
approvalState
```

这些属于前端 ViewModel。

---

## 10.2 枚举

所有业务枚举必须逐字复用 SMPP 已有枚举。

禁止：

```text
新增 UI 友好枚举
重新命名枚举值
合并多个领域状态
使用统一 EntityStatus
删除现有状态
缩小现有枚举集合
```

---

## 10.3 Revision 与并发

不得为了统一接口而强制所有资源使用：

```text
ETag
If-Match
revision
```

必须审计当前业务实际使用的：

```text
expectedUpdatedAt
expectedRevision
observedRevision
fencingToken
其他 CAS 字段
```

合同必须忠实描述当前语义。

本任务不得改变现有并发控制方式。

---

## 10.4 幂等

只有当前命令已经存在正式幂等机制时，合同才能声明：

```text
Idempotency-Key
```

否则不得在合同中承诺幂等。

---

## 10.5 分页

分页方式必须复用现有查询能力。

```text
已有 Cursor
→ 复用 Cursor

已有 limit/cursor
→ 如实冻结

只有受限列表
→ 记录现有上限

没有安全分页
→ Endpoint 延后或明确边界
```

不得为了合同统一修改 Repository 查询。

---

# 十一、API 路径

Console 合同使用独立前缀：

```text
/api/console/v1
```

但本任务不得实现该 Route。

它与现有机器接口保持隔离：

```text
/api/console/v1/**
    → 未来 PMS Web 管理接口

/api/v1/runtime-config/**
    → Runtime 机器接口

/api/v1/runtime-registration/**
    → Runtime 机器接口

/health/**
    → 运维探针
```

不得：

```text
删除现有 /api/v1 Route
修改现有 Route 行为
改变 Runtime 机器接口
把 Runtime Credential 用于 Console
```

---

# 十二、OpenAPI 结构

必须生成：

```text
contracts/pms-console-api/v1/
├── openapi.yaml
├── CONTRACT.md
├── RESOURCE_MODEL.md
├── ERROR_CATALOG.md
├── CHANGE_POLICY.md
├── BASELINE.json
├── EXISTING_OBJECT_INVENTORY.md
├── EXISTING_CAPABILITY_MATRIX.md
├── EXISTING_ROUTE_INVENTORY.md
├── EXISTING_ERROR_INVENTORY.md
├── EXISTING_ENUM_INVENTORY.md
├── ENDPOINT_SOURCE_MAP.json
├── ERROR_SOURCE_MAP.json
├── WEB_API_MAPPING.md
├── DEFERRED_SURFACES.md
├── NON_IMPACT_PROOF.md
├── examples/
├── schemas/
├── conformance-cases/
├── business-baseline.sha256
├── business-final.sha256
└── contract-lock.json
```

---

# 十三、PMS Web 映射

对前端的每一个 Gateway 方法分类为：

```text
FROZEN_API
WEB_COMPOSED
MOCK_DEFERRED
FORBIDDEN
```

生成：

```text
contracts/pms-console-api/v1/WEB_API_MAPPING.md
```

示例：

```text
ProviderGateway.listProviders
→ FROZEN_API

ProviderGateway.onboardProvider
→ WEB_COMPOSED
→ 由多个已有接口组成
→ 不新增 onboarding endpoint

OperationsGateway.startOperation
→ MOCK_DEFERRED
→ SMPP 无 Generic Operation Domain

OperationsGateway.closeIncident
→ MOCK_DEFERRED
→ SMPP 无 Incident Domain
```

PMS Web 当前的：

```text
EntityStatus
PrototypeOperation
MockCheckResult
ConfigurationProfile
```

不得直接复制到 OpenAPI。

---

# 十四、合同实现包

允许新增：

```text
packages/pms-console-api-contract
packages/pms-console-api-testkit
```

不得在本任务创建真实 API Client 实现。

`pms-console-api-contract` 只允许包含：

```text
生成的 DTO 类型
JSON Schema Bundle
ProblemDetails 类型
合同版本常量
Schema 验证函数
```

不得依赖：

```text
pms-domain
pms-application
pms-persistence-postgres
pms-worker
runtime
pm2
```

`pms-console-api-testkit` 只允许包含：

```text
示例加载
Schema 校验
Source Map 校验
Breaking Change 检查
合同一致性测试
```

不得包含业务逻辑。

---

# 十五、SMPP 业务零影响证明

## 15.1 建立业务基线 Hash

任务开始时计算：

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

输出：

```text
contracts/pms-console-api/v1/business-baseline.sha256
```

冻结前再次生成：

```text
contracts/pms-console-api/v1/business-final.sha256
```

两者必须完全一致。

---

## 15.2 Git 范围验证

验证最终差异只能位于允许范围。

必须提供自动脚本，例如：

```text
scripts/pms-console-contract/verify-scope.mjs
```

一旦发现生产代码、Migration 或 Protocol 变化，必须失败。

---

## 15.3 NON_IMPACT_PROOF

生成：

```text
contracts/pms-console-api/v1/NON_IMPACT_PROOF.md
```

必须明确证明：

```text
生产代码未修改
领域对象未修改
领域枚举未修改
Application Port 未修改
Repository Port 未修改
Migration 未修改
Protocol 未修改
Worker Job Type 未修改
生产 Route 未修改
数据库结构未修改
业务事务边界未修改
```

---

# 十六、合同验证

## 16.1 静态验证

至少完成：

```text
OpenAPI lint
OpenAPI bundle
所有 $ref 可解析
operationId 唯一
Schema 可编译
示例符合 Schema
业务枚举有来源
错误码有来源
Endpoint 有来源
无 TODO
无 TBD
无 unresolved placeholder
```

---

## 16.2 Source Map 验证

建立脚本检查：

```text
每个 OpenAPI Operation 都有 Endpoint Source Map
每个写 Operation 都映射一个现有 Application Command
每个 Problem Code 都有 Error Source Map
每个业务枚举都存在于 Existing Enum Inventory
每个业务 Schema 都映射现有对象
```

---

## 16.3 新业务对象检查

建立对象白名单。

允许的纯传输对象：

```text
ProblemDetails
FieldProblem
PageInfo
Link
RequestMetadata
CorrelationMetadata
```

其他 OpenAPI Schema 名称必须能够映射到：

```text
EXISTING_OBJECT_INVENTORY.md
```

不能映射则失败。

---

## 16.4 Breaking Change 基线

生成冻结后的 Bundle，例如：

```text
contracts/pms-console-api/v1/dist/openapi.bundle.yaml
```

建立 Breaking Baseline：

```text
contracts/pms-console-api/v1/breaking-baseline/
```

后续修改必须能够检测：

```text
Endpoint 删除
字段删除
字段变必填
类型改变
枚举缩小
状态码改变
错误语义改变
并发语义改变
```

---

# 十七、Contract Lock

生成：

```text
contracts/pms-console-api/v1/contract-lock.json
```

结构：

```json
{
  "contract": "pms-console-api",
  "version": "1.0.0",
  "status": "frozen",
  "baselineCommit": "<main-sha>",
  "openApiSha256": "<sha256>",
  "schemaBundleSha256": "<sha256>",
  "endpointSourceMapSha256": "<sha256>",
  "errorSourceMapSha256": "<sha256>",
  "businessBaselineSha256": "<sha256>",
  "businessFinalSha256": "<sha256>",
  "businessSourceUnchanged": true,
  "migrationsUnchanged": true,
  "protocolUnchanged": true,
  "frozenAt": "<RFC3339>"
}
```

Hash 必须由脚本生成，不得手工填写。

---

# 十八、合同状态

执行过程中使用：

```text
Contract Draft
Contract Candidate
Contract Frozen
```

只有所有门禁通过后，才能将：

```text
CONTRACT.md
contract-lock.json
```

状态修改为：

```text
Contract Frozen
```

必须明确说明：

```text
Contract Frozen
≠ PMS API Conformant
≠ PMS Web Conformant
≠ Console E2E Aligned
```

本任务不宣称两端实现完成。

---

# 十九、测试命令

根据实际工具链建立命令，建议至少提供：

```bash
pnpm pms-console-contract:lint
pnpm pms-console-contract:bundle
pnpm pms-console-contract:test
pnpm pms-console-contract:check-sources
pnpm pms-console-contract:check-business-impact
pnpm pms-console-contract:check-breaking
pnpm pms-console-contract:check-lock
```

同时运行仓库现有静态门禁：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
git diff --check
```

本任务不应要求 PostgreSQL、PM2、Runtime 或真实 Provider 启动。

如果某个仓库级测试必须依赖这些环境，应记录为未执行的既有集成门禁，不得伪造通过结果。

---

# 二十、冻结门禁

只有全部满足才能完成：

1. 固定任务开始时最新 `main` SHA；
   2.完整审计现有对象、能力、Route、错误和枚举；
   3.每个 Endpoint 有代码来源；
   4.每个写接口映射现有 Application Command；
   5.每个 DTO 字段有来源；
   6.每个业务枚举逐字复用现有枚举；
   7.每个 Problem Code 有现有错误来源；
   8.不存在新增业务对象；
   9.不存在新增业务命令；
   10.不存在新增状态机；
   11.不存在新事务编排；
   12.不存在 Generic Operation API；
   13.不存在 Incident API；
   14.不存在 Change Request API；
   15.不存在 Environment Management API；
   16.不存在 Catalog 手工编辑 API；
   17.不存在 Registry 手工编辑 API；
   18.所有不支持页面已标记 Deferred；
   19.OpenAPI 和 Schema 校验通过；
   20.所有示例校验通过；
   21.无 TODO/TBD；
   22.业务基线和最终 Hash 完全一致；
   23.Migration Hash 完全一致；
   24.Protocol Hash 完全一致；
   25.生产 API Route 未修改；
   26.Breaking Baseline 已生成；
   27.Contract Lock 已生成并通过；
   28.NON_IMPACT_PROOF 完整；
   29.最终报告明确冻结与延后范围；
   30.最终 ZIP 校验通过。

---

# 二十一、交付文件

至少交付：

```text
contracts/pms-console-api/v1/**
packages/pms-console-api-contract/**
packages/pms-console-api-testkit/**
scripts/pms-console-contract/**
docs/adr/*pms-console*
docs/review/PMS_CONSOLE_API_CONTRACT_V1_REVIEW.md
docs/review/PMS_CONSOLE_API_CONTRACT_V1_HANDOFF.md
reports/pms-console-api-contract-v1/TEST_EVIDENCE.json
DELIVERY_REPORT.md
```

---

# 二十二、测试证据

生成：

```text
reports/pms-console-api-contract-v1/TEST_EVIDENCE.json
```

至少包含：

```json
{
  "contract": "pms-console-api",
  "version": "1.0.0",
  "status": "frozen",
  "baselineCommit": "",
  "commands": [],
  "exitCodes": [],
  "operationCount": 0,
  "schemaCount": 0,
  "exampleCount": 0,
  "frozenOperations": [],
  "deferredSurfaces": [],
  "forbiddenSurfaces": [],
  "endpointSourceMapComplete": true,
  "errorSourceMapComplete": true,
  "businessSourceUnchanged": true,
  "migrationsUnchanged": true,
  "protocolUnchanged": true,
  "productionRoutesUnchanged": true,
  "todoCount": 0,
  "tbdCount": 0,
  "secretsIncluded": false
}
```

不得只写：

```text
all tests passed
```

---

# 二十三、交付报告

`DELIVERY_REPORT.md` 必须包括：

```text
执行基线
审计范围
已有业务对象
已有查询能力
已有命令能力
冻结的 Endpoint
延后的 Endpoint
禁止的 Endpoint
PMS Web Gateway 映射
错误映射
枚举映射
业务零影响证明
合同验证结果
Breaking Baseline
Contract Lock
已知限制
下一阶段 PMS API 实现范围
下一阶段 PMS Web 接入范围
```

---

# 二十四、ZIP 交付

最终生成：

```text
pms-console-api-contract-v1-frozen.zip
```

ZIP 中应包含：

```text
完整合同目录
合同 Package
合同 Testkit
验证脚本
审计文档
评审文档
测试证据
交付报告
必要的 Workspace 文件
pnpm-lock.yaml
```

不得包含：

```text
node_modules
dist 临时构建目录
coverage
.git
.env
Token
Secret
数据库连接串
临时日志
系统缓存
原始 pms-web ZIP
```

生成：

```text
pms-console-api-contract-v1-frozen.zip.sha256
```

校验：

```bash
unzip -t pms-console-api-contract-v1-frozen.zip
sha256sum -c pms-console-api-contract-v1-frozen.zip.sha256
```

---

# 二十五、Work 模式执行规则

1. 先审计，再设计，不得直接开始写 OpenAPI；
   2.不确定某项能力是否存在时，必须搜索代码和测试；
   3.不得根据常见 REST 设计自行补齐业务；
   4.不得把前端 Mock 当成业务事实；
   5.不得把现有 API 返回 Shape 自动认定为冻结合同；
   6.合同中的每个业务语义必须有仓库证据；
   7.缺少证据时必须 Deferred，不得猜测；
   8.无需等待人工逐项确认，按最保守原则继续；
   9.遇到冲突时，以 SMPP `main` 现有业务语义为准；
   10.不得放宽任何安全、身份、Secret 或权威边界；
   11.每个阶段完成后运行对应验证；
   12.最后必须返回 ZIP 和 SHA-256；
   13.完成合同冻结后立即停止；
   14.不得继续实现 PMS API Route；
   15.不得继续修改 PMS Web Gateway；
   16.不得开启真实 API 联调。

---

# 二十六、最终回答格式

任务完成后只需汇报：

```text
基线 Commit
冻结状态
冻结 Endpoint 数量
Deferred 数量
Forbidden 数量
业务代码是否变化
Migration 是否变化
Protocol 是否变化
全部验证命令结果
ZIP 文件名
ZIP SHA-256
主要已知限制
```

并提供：

```text
pms-console-api-contract-v1-frozen.zip
pms-console-api-contract-v1-frozen.zip.sha256
```
