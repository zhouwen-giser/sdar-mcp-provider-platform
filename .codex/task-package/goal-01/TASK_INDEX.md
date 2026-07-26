# Task Index

| ID | 阶段 | 任务 | 依赖 | 推荐提交 |
|---|---|---|---|---|
| `G1-P0-B01` | P0 基线锁定 | [校验离线交付来源并生成基线清单](tasks/G1-P0-B01.md) | - | `docs(baseline): G1-P0-B01 lock offline delivery baseline` |
| `G1-P0-B02` | P0 基线锁定 | [建立 Git 基线与来源追踪](tasks/G1-P0-B02.md) | G1-P0-B01 | `chore(repo): G1-P0-B02 establish source lock` |
| `G1-P0-B03` | P0 基线锁定 | [建立平台命名与仓库元数据](tasks/G1-P0-B03.md) | G1-P0-B02 | `docs(platform): G1-P0-B03 establish platform repository identity` |
| `G1-P0-B04` | P0 基线锁定 | [固化 Runtime 冻结协议回归门禁](tasks/G1-P0-B04.md) | G1-P0-B03 | `test(runtime): G1-P0-B04 lock frozen protocol regression gate` |
| `G1-P0-B05` | P0 基线锁定 | [固化 UGV/NPC/HA Provider 回归门禁](tasks/G1-P0-B05.md) | G1-P0-B03 | `test(provider): G1-P0-B05 lock provider regression gates` |
| `G1-P0-B06` | P0 基线锁定 | [发布 P0 基线阶段报告](tasks/G1-P0-B06.md) | G1-P0-B04, G1-P0-B05 | `docs(codex): G1-P0-B06 publish baseline phase report` |
| `G1-P1-B01` | P1 Migration 隔离 | [建立 Migration 所有权与路径映射](tasks/G1-P1-B01.md) | G1-P0-B06 | `docs(migrations): G1-P1-B01 map migration ownership` |
| `G1-P1-B02` | P1 Migration 隔离 | [物理拆分 Runtime Migration 集合](tasks/G1-P1-B02.md) | G1-P1-B01 | `refactor(migrations): G1-P1-B02 isolate runtime migration files` |
| `G1-P1-B03` | P1 Migration 隔离 | [物理拆分 Provider Migration 集合](tasks/G1-P1-B03.md) | G1-P1-B02 | `refactor(migrations): G1-P1-B03 isolate provider migrations` |
| `G1-P1-B04` | P1 Migration 隔离 | [实现显式 MigrationSet 解析器](tasks/G1-P1-B04.md) | G1-P1-B03 | `feat(migrations): G1-P1-B04 add explicit migration set resolver` |
| `G1-P1-B05` | P1 Migration 隔离 | [改造 Runtime Migration Runner](tasks/G1-P1-B05.md) | G1-P1-B04 | `refactor(runtime-db): G1-P1-B05 bind runtime migration set` |
| `G1-P1-B06` | P1 Migration 隔离 | [改造 UGV 与 NPC Provider Migration Runner](tasks/G1-P1-B06.md) | G1-P1-B04 | `refactor(provider-db): G1-P1-B06 bind provider migration sets` |
| `G1-P1-B07` | P1 Migration 隔离 | [增加 Migration 隔离集成测试](tasks/G1-P1-B07.md) | G1-P1-B05, G1-P1-B06 | `test(migrations): G1-P1-B07 prove migration isolation` |
| `G1-P1-B08` | P1 Migration 隔离 | [完成 Migration 兼容与阶段门禁](tasks/G1-P1-B08.md) | G1-P1-B07 | `docs(migrations): G1-P1-B08 close migration isolation phase` |
| `G1-P2-B01` | P2 Provider Package | [定义 ProviderPackage 领域模型和 JSON Schema](tasks/G1-P2-B01.md) | G1-P1-B08 | `feat(provider-package): G1-P2-B01 define provider package schema` |
| `G1-P2-B02` | P2 Provider Package | [创建 UGV Provider Package 描述](tasks/G1-P2-B02.md) | G1-P2-B01 | `feat(provider-package): G1-P2-B02 add UGV package` |
| `G1-P2-B03` | P2 Provider Package | [创建 NPC Tank Provider Package 描述](tasks/G1-P2-B03.md) | G1-P2-B01 | `feat(provider-package): G1-P2-B03 add NPC tank package` |
| `G1-P2-B04` | P2 Provider Package | [创建 Home Assistant Climate Provider Package 描述](tasks/G1-P2-B04.md) | G1-P2-B01 | `feat(provider-package): G1-P2-B04 add Home Assistant climate package` |
| `G1-P2-B05` | P2 Provider Package | [实现 Provider Package Loader 与 Registry](tasks/G1-P2-B05.md) | G1-P2-B02, G1-P2-B03, G1-P2-B04 | `feat(provider-package): G1-P2-B05 implement package registry` |
| `G1-P2-B06` | P2 Provider Package | [隔离 Mock Fixtures 与资格状态](tasks/G1-P2-B06.md) | G1-P2-B05 | `fix(provider-package): G1-P2-B06 enforce qualification boundaries` |
| `G1-P2-B07` | P2 Provider Package | [提供 Provider Package Self-check CLI 与阶段报告](tasks/G1-P2-B07.md) | G1-P2-B05, G1-P2-B06 | `feat(provider-package): G1-P2-B07 add package self-check gate` |
| `G1-P3-B01` | P3 共享配置契约 | [盘点现有 Runtime 与 Provider 配置](tasks/G1-P3-B01.md) | G1-P2-B07 | `docs(config): G1-P3-B01 inventory existing configuration` |
| `G1-P3-B02` | P3 共享配置契约 | [定义共享 ConfigurationDefinition 基础类型](tasks/G1-P3-B02.md) | G1-P3-B01 | `feat(config-contract): G1-P3-B02 define configuration metadata` |
| `G1-P3-B03` | P3 共享配置契约 | [抽取 Runtime 身份与数据库配置契约](tasks/G1-P3-B03.md) | G1-P3-B02 | `refactor(runtime-config): G1-P3-B03 extract identity and database contract` |
| `G1-P3-B04` | P3 共享配置契约 | [抽取 Runtime Observability 配置契约](tasks/G1-P3-B04.md) | G1-P3-B02 | `refactor(runtime-config): G1-P3-B04 extract observability contract` |
| `G1-P3-B05` | P3 共享配置契约 | [抽取 Runtime Worker 与 Business Events 配置](tasks/G1-P3-B05.md) | G1-P3-B02 | `refactor(runtime-config): G1-P3-B05 extract worker and events contract` |
| `G1-P3-B06` | P3 共享配置契约 | [抽取 UGV Provider 配置契约](tasks/G1-P3-B06.md) | G1-P3-B02 | `refactor(ugv-config): G1-P3-B06 share UGV configuration contract` |
| `G1-P3-B07` | P3 共享配置契约 | [抽取 NPC Tank Provider 配置契约](tasks/G1-P3-B07.md) | G1-P3-B02 | `refactor(npc-config): G1-P3-B07 share NPC configuration contract` |
| `G1-P3-B08` | P3 共享配置契约 | [抽取 Home Assistant Climate 配置契约](tasks/G1-P3-B08.md) | G1-P3-B02 | `refactor(climate-config): G1-P3-B08 share climate configuration contract` |
| `G1-P3-B09` | P3 共享配置契约 | [生成 JSON Schema 与 PMS 表单元数据](tasks/G1-P3-B09.md) | G1-P3-B03, G1-P3-B04, G1-P3-B05, G1-P3-B06, G1-P3-B07, G1-P3-B08 | `feat(config-contract): G1-P3-B09 generate schemas and form metadata` |
| `G1-P3-B10` | P3 共享配置契约 | [完成配置兼容回归与阶段门禁](tasks/G1-P3-B10.md) | G1-P3-B09 | `test(config-contract): G1-P3-B10 close configuration contract phase` |
| `G1-P4-B01` | P4 PMS 核心与持久化 | [建立 PMS Domain 包与核心值对象](tasks/G1-P4-B01.md) | G1-P3-B10 | `feat(pms-domain): G1-P4-B01 establish control-plane domain` |
| `G1-P4-B02` | P4 PMS 核心与持久化 | [设计 PMS Control Plane 初始 Migration](tasks/G1-P4-B02.md) | G1-P4-B01 | `feat(pms-db): G1-P4-B02 add control-plane schema` |
| `G1-P4-B03` | P4 PMS 核心与持久化 | [定义 PMS Repository Ports 与事务边界](tasks/G1-P4-B03.md) | G1-P4-B01 | `feat(pms-domain): G1-P4-B03 define repository ports` |
| `G1-P4-B04` | P4 PMS 核心与持久化 | [实现 PostgreSQL PMS Persistence](tasks/G1-P4-B04.md) | G1-P4-B02, G1-P4-B03 | `feat(pms-db): G1-P4-B04 implement PostgreSQL persistence` |
| `G1-P4-B05` | P4 PMS 核心与持久化 | [实现 Provider Package 导入投影](tasks/G1-P4-B05.md) | G1-P2-B07, G1-P4-B04 | `feat(pms): G1-P4-B05 synchronize provider packages` |
| `G1-P4-B06` | P4 PMS 核心与持久化 | [实现 Audit 与 Job Lease 基础能力](tasks/G1-P4-B06.md) | G1-P4-B04 | `feat(pms): G1-P4-B06 add audit and job lease` |
| `G1-P4-B07` | P4 PMS 核心与持久化 | [建立 PMS Worker 基础骨架与 P4 门禁](tasks/G1-P4-B07.md) | G1-P4-B05, G1-P4-B06 | `feat(pms-worker): G1-P4-B07 establish worker foundation` |
| `G1-P5-B01` | P5 API 与配置中心 | [建立 PMS API 应用骨架与错误合同](tasks/G1-P5-B01.md) | G1-P4-B07 | `feat(pms-api): G1-P5-B01 scaffold control-plane API` |
| `G1-P5-B02` | P5 API 与配置中心 | [实现 Provider Package 查询 API](tasks/G1-P5-B02.md) | G1-P5-B01 | `feat(pms-api): G1-P5-B02 expose provider packages` |
| `G1-P5-B03` | P5 API 与配置中心 | [实现 Provider/Resource 管理 API](tasks/G1-P5-B03.md) | G1-P5-B01 | `feat(pms-api): G1-P5-B03 add provider resource APIs` |
| `G1-P5-B04` | P5 API 与配置中心 | [实现 Config Draft 与 Validate](tasks/G1-P5-B04.md) | G1-P3-B10, G1-P5-B01 | `feat(config-center): G1-P5-B04 implement draft validation` |
| `G1-P5-B05` | P5 API 与配置中心 | [实现 Config Publish、No-op 与 Rollback](tasks/G1-P5-B05.md) | G1-P5-B04 | `feat(config-center): G1-P5-B05 publish and rollback revisions` |
| `G1-P5-B06` | P5 API 与配置中心 | [实现 Runtime Config Latest 与 ETag](tasks/G1-P5-B06.md) | G1-P5-B05 | `feat(runtime-config-api): G1-P5-B06 expose latest config` |
| `G1-P5-B07` | P5 API 与配置中心 | [实现 Runtime Config Watch 与 Ack](tasks/G1-P5-B07.md) | G1-P5-B06 | `feat(runtime-config-api): G1-P5-B07 add watch and acknowledgements` |
| `G1-P5-B08` | P5 API 与配置中心 | [完成 API 安全、OpenAPI 与 P5 阶段门禁](tasks/G1-P5-B08.md) | G1-P5-B02, G1-P5-B03, G1-P5-B07 | `test(pms-api): G1-P5-B08 close API configuration phase` |
| `G1-P6-B01` | P6 Runtime Config Client | [实现 Runtime Config Client Pull 与本地 Cache](tasks/G1-P6-B01.md) | G1-P5-B06 | `feat(runtime-config-client): G1-P6-B01 implement pull and cache` |
| `G1-P6-B02` | P6 Runtime Config Client | [实现 Watch、Apply、Ack 与 LKG 状态机](tasks/G1-P6-B02.md) | G1-P5-B07, G1-P6-B01 | `feat(runtime-config-client): G1-P6-B02 complete apply and LKG workflow` |
| `G1-P6-B03` | P6 Runtime Config Client | [接入 Runtime 的首个可验证动态配置闭环](tasks/G1-P6-B03.md) | G1-P3-B04, G1-P6-B02 | `feat(runtime): G1-P6-B03 integrate runtime config client` |
| `G1-P6-B04` | P6 Runtime Config Client | [完成 Goal 1 验收与 Handoff](tasks/G1-P6-B04.md) | G1-P6-B03 | `chore(delivery): G1-P6-B04 complete goal 01 handoff` |
