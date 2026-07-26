# Task Traceability Matrix

| Task | Design area | Primary verification |
|---|---|---|
| `G1-P0-B01` 校验离线交付来源并生成基线清单 | P0 基线锁定 | `bash .codex/task-package/scripts/verify_source_baseline.sh` |
| `G1-P0-B02` 建立 Git 基线与来源追踪 | P0 基线锁定 | `git status --short` |
| `G1-P0-B03` 建立平台命名与仓库元数据 | P0 基线锁定 | `pnpm format:check || true` |
| `G1-P0-B04` 固化 Runtime 冻结协议回归门禁 | P0 基线锁定 | `pnpm protocol:check` |
| `G1-P0-B05` 固化 UGV/NPC/HA Provider 回归门禁 | P0 基线锁定 | `pnpm test:unit` |
| `G1-P0-B06` 发布 P0 基线阶段报告 | P0 基线锁定 | `git diff --check` |
| `G1-P1-B01` 建立 Migration 所有权与路径映射 | P1 Migration 隔离 | `python3 .codex/task-package/scripts/verify_migration_source_map.py` |
| `G1-P1-B02` 物理拆分 Runtime Migration 集合 | P1 Migration 隔离 | `python3 .codex/task-package/scripts/verify_migration_source_map.py` |
| `G1-P1-B03` 物理拆分 Provider Migration 集合 | P1 Migration 隔离 | `python3 .codex/task-package/scripts/verify_migration_source_map.py` |
| `G1-P1-B04` 实现显式 MigrationSet 解析器 | P1 Migration 隔离 | `pnpm --filter @sdar/database-migration-runner test` |
| `G1-P1-B05` 改造 Runtime Migration Runner | P1 Migration 隔离 | `pnpm db:migrate --help || true` |
| `G1-P1-B06` 改造 UGV 与 NPC Provider Migration Runner | P1 Migration 隔离 | `pnpm typecheck` |
| `G1-P1-B07` 增加 Migration 隔离集成测试 | P1 Migration 隔离 | `pnpm test:migration-isolation` |
| `G1-P1-B08` 完成 Migration 兼容与阶段门禁 | P1 Migration 隔离 | `rg "migrations" apps packages | head -200` |
| `G1-P2-B01` 定义 ProviderPackage 领域模型和 JSON Schema | P2 Provider Package | `pnpm --filter @sdar/provider-package-registry test` |
| `G1-P2-B02` 创建 UGV Provider Package 描述 | P2 Provider Package | `pnpm test:provider-packages` |
| `G1-P2-B03` 创建 NPC Tank Provider Package 描述 | P2 Provider Package | `pnpm test:provider-packages` |
| `G1-P2-B04` 创建 Home Assistant Climate Provider Package 描述 | P2 Provider Package | `pnpm test:provider-packages` |
| `G1-P2-B05` 实现 Provider Package Loader 与 Registry | P2 Provider Package | `pnpm --filter @sdar/provider-package-registry test` |
| `G1-P2-B06` 隔离 Mock Fixtures 与资格状态 | P2 Provider Package | `pnpm test:provider-packages` |
| `G1-P2-B07` 提供 Provider Package Self-check CLI 与阶段报告 | P2 Provider Package | `pnpm test:provider-packages` |
| `G1-P3-B01` 盘点现有 Runtime 与 Provider 配置 | P3 共享配置契约 | `python3 .codex/task-package/scripts/verify_config_inventory.py` |
| `G1-P3-B02` 定义共享 ConfigurationDefinition 基础类型 | P3 共享配置契约 | `pnpm --filter @sdar/runtime-configuration-contract test` |
| `G1-P3-B03` 抽取 Runtime 身份与数据库配置契约 | P3 共享配置契约 | `pnpm --filter @sdar/runtime-configuration-contract test` |
| `G1-P3-B04` 抽取 Runtime Observability 配置契约 | P3 共享配置契约 | `pnpm --filter @sdar/runtime-configuration-contract test` |
| `G1-P3-B05` 抽取 Runtime Worker 与 Business Events 配置 | P3 共享配置契约 | `pnpm --filter @sdar/runtime-configuration-contract test` |
| `G1-P3-B06` 抽取 UGV Provider 配置契约 | P3 共享配置契约 | `pnpm --filter @sdar/ugv-provider-adapter test` |
| `G1-P3-B07` 抽取 NPC Tank Provider 配置契约 | P3 共享配置契约 | `pnpm --filter @sdar/npc-tank-provider-adapter test` |
| `G1-P3-B08` 抽取 Home Assistant Climate 配置契约 | P3 共享配置契约 | `pnpm --filter @sdar/home-assistant-climate-provider test` |
| `G1-P3-B09` 生成 JSON Schema 与 PMS 表单元数据 | P3 共享配置契约 | `pnpm config:schema:generate` |
| `G1-P3-B10` 完成配置兼容回归与阶段门禁 | P3 共享配置契约 | `pnpm test:config-compat` |
| `G1-P4-B01` 建立 PMS Domain 包与核心值对象 | P4 PMS 核心与持久化 | `pnpm --filter @sdar/pms-domain test` |
| `G1-P4-B02` 设计 PMS Control Plane 初始 Migration | P4 PMS 核心与持久化 | `pnpm test:pms-migrations` |
| `G1-P4-B03` 定义 PMS Repository Ports 与事务边界 | P4 PMS 核心与持久化 | `pnpm --filter @sdar/pms-domain test` |
| `G1-P4-B04` 实现 PostgreSQL PMS Persistence | P4 PMS 核心与持久化 | `pnpm --filter @sdar/pms-persistence-postgres test` |
| `G1-P4-B05` 实现 Provider Package 导入投影 | P4 PMS 核心与持久化 | `pnpm test:pms` |
| `G1-P4-B06` 实现 Audit 与 Job Lease 基础能力 | P4 PMS 核心与持久化 | `pnpm test:pms` |
| `G1-P4-B07` 建立 PMS Worker 基础骨架与 P4 门禁 | P4 PMS 核心与持久化 | `pnpm --filter @sdar/pms-worker test` |
| `G1-P5-B01` 建立 PMS API 应用骨架与错误合同 | P5 API 与配置中心 | `pnpm --filter @sdar/pms-api test` |
| `G1-P5-B02` 实现 Provider Package 查询 API | P5 API 与配置中心 | `pnpm --filter @sdar/pms-api test` |
| `G1-P5-B03` 实现 Provider/Resource 管理 API | P5 API 与配置中心 | `pnpm --filter @sdar/pms-api test` |
| `G1-P5-B04` 实现 Config Draft 与 Validate | P5 API 与配置中心 | `pnpm test:pms-config` |
| `G1-P5-B05` 实现 Config Publish、No-op 与 Rollback | P5 API 与配置中心 | `pnpm test:pms-config` |
| `G1-P5-B06` 实现 Runtime Config Latest 与 ETag | P5 API 与配置中心 | `pnpm test:pms-config-e2e` |
| `G1-P5-B07` 实现 Runtime Config Watch 与 Ack | P5 API 与配置中心 | `pnpm test:pms-config-e2e` |
| `G1-P5-B08` 完成 API 安全、OpenAPI 与 P5 阶段门禁 | P5 API 与配置中心 | `pnpm test:pms-config-e2e` |
| `G1-P6-B01` 实现 Runtime Config Client Pull 与本地 Cache | P6 Runtime Config Client | `pnpm --filter @sdar/runtime-config-client test` |
| `G1-P6-B02` 实现 Watch、Apply、Ack 与 LKG 状态机 | P6 Runtime Config Client | `pnpm --filter @sdar/runtime-config-client test` |
| `G1-P6-B03` 接入 Runtime 的首个可验证动态配置闭环 | P6 Runtime Config Client | `pnpm test:pms-config-e2e` |
| `G1-P6-B04` 完成 Goal 1 验收与 Handoff | P6 Runtime Config Client | `pnpm build` |
| `G2-P0-B01` 验证 Goal 1 Handoff 与仓库门禁 | P0 Goal 2 预检 | `python3 .codex/task-package/scripts/verify_goal1_handoff.py --repo .` |
| `G2-P0-B02` 确认 PM2/PostgreSQL 环境与 Fake 策略 | P0 Goal 2 预检 | `node --version` |
| `G2-P0-B03` 冻结 Goal 2 领域决策与 ADR | P0 Goal 2 预检 | `git diff --check` |
| `G2-P0-B04` 建立 Goal 2 阶段门禁与报告骨架 | P0 Goal 2 预检 | `pnpm --version` |
| `G2-P1-B01` 定义 RuntimeDeployment 聚合与状态机 | P1 RuntimeDeployment | `pnpm --filter @sdar/runtime-deployment test` |
| `G2-P1-B02` 定义 RuntimeProcess 投影与实际状态 | P1 RuntimeDeployment | `pnpm --filter @sdar/runtime-deployment test` |
| `G2-P1-B03` 增加 RuntimeDeployment PMS Migration | P1 RuntimeDeployment | `pnpm test:pms-migrations` |
| `G2-P1-B04` 实现 Deployment Repository 与并发更新 | P1 RuntimeDeployment | `pnpm --filter @sdar/pms-persistence-postgres test` |
| `G2-P1-B05` 实现 RuntimeDeployment Application Use Cases | P1 RuntimeDeployment | `pnpm test:pms` |
| `G2-P1-B06` 实现 RuntimeDeployment 管理 API | P1 RuntimeDeployment | `pnpm --filter @sdar/pms-api test` |
| `G2-P1-B07` 实现 RuntimeProcess 查询与日志引用 API | P1 RuntimeDeployment | `pnpm --filter @sdar/pms-api test` |
| `G2-P1-B08` 完成 RuntimeDeployment 契约与阶段门禁 | P1 RuntimeDeployment | `pnpm test:runtime-deployment` |
| `G2-P2-B01` 定义 DatabaseProfile 与 SecretRef 模型 | P2 数据库自动准备 | `pnpm test:pms` |
| `G2-P2-B02` 增加 DatabaseProfile PMS Migration 与 Repository | P2 数据库自动准备 | `pnpm test:pms-migrations` |
| `G2-P2-B03` 定义 PostgresProvisioner Port 与错误模型 | P2 数据库自动准备 | `pnpm --filter @sdar/runtime-deployment test` |
| `G2-P2-B04` 实现 PostgreSQL Provisioner | P2 数据库自动准备 | `pnpm --filter @sdar/postgres-provisioner test` |
| `G2-P2-B05` 实现 File Secret Store Adapter | P2 数据库自动准备 | `pnpm --filter @sdar/secret-store test` |
| `G2-P2-B06` 实现 Runtime Migration Runner 编排 | P2 数据库自动准备 | `pnpm --filter @sdar/runtime-migration-runner test` |
| `G2-P2-B07` 实现数据库准备 Application Job | P2 数据库自动准备 | `pnpm test:db-provisioner` |
| `G2-P2-B08` 增加数据库权限与隔离 E2E | P2 数据库自动准备 | `pnpm test:db-provisioner-e2e` |
| `G2-P2-B09` 完成数据库自动准备阶段门禁 | P2 数据库自动准备 | `pnpm test:db-provisioner` |
| `G2-P3-B01` 定义 RuntimeInfrastructureAdapter Port | P3 PM2 与运行对账 | `pnpm --filter @sdar/runtime-deployment test` |
| `G2-P3-B02` 实现 BootstrapConfigRenderer | P3 PM2 与运行对账 | `pnpm --filter @sdar/pm2-runtime-adapter test` |
| `G2-P3-B03` 实现 PM2 Process Manager 基础封装 | P3 PM2 与运行对账 | `pnpm --filter @sdar/pm2-runtime-adapter test` |
| `G2-P3-B04` 实现 Runtime 版本与入口解析 | P3 PM2 与运行对账 | `pnpm --filter @sdar/pm2-runtime-adapter test` |
| `G2-P3-B05` 实现端口分配与实例命名 | P3 PM2 与运行对账 | `pnpm test:runtime-deployment` |
| `G2-P3-B06` 实现 Runtime Start/Stop/Restart/Delete | P3 PM2 与运行对账 | `pnpm test:pm2-adapter` |
| `G2-P3-B07` 实现 Runtime Health Probe | P3 PM2 与运行对账 | `pnpm test:pm2-adapter` |
| `G2-P3-B08` 扩展 Runtime Bootstrap 身份与 Secret File 支持 | P3 PM2 与运行对账 | `pnpm --filter @sdar/runtime test` |
| `G2-P3-B09` 实现 RuntimeDeployment Reconcile Worker | P3 PM2 与运行对账 | `pnpm test:runtime-reconcile` |
| `G2-P3-B10` 实现崩溃恢复与重启策略 | P3 PM2 与运行对账 | `pnpm test:pm2-adapter` |
| `G2-P3-B11` 实现停止与排空流程 | P3 PM2 与运行对账 | `pnpm test:runtime-reconcile` |
| `G2-P3-B12` 完成真实 PM2 集成与 P3 门禁 | P3 PM2 与运行对账 | `pnpm test:pm2-adapter-e2e` |
| `G2-P4-B01` 定义 Runtime Registration 与 Heartbeat 模型 | P4 注册、Catalog 与 Registry | `pnpm --filter @sdar/runtime-registration test` |
| `G2-P4-B02` 实现 Runtime Registration/Heartbeat API 与 Client | P4 注册、Catalog 与 Registry | `pnpm test:runtime-registration` |
| `G2-P4-B03` 实现 Provider 身份三方校验 | P4 注册、Catalog 与 Registry | `pnpm test:runtime-registration` |
| `G2-P4-B04` 实现 Catalog Discovery Client 与验证 | P4 注册、Catalog 与 Registry | `pnpm --filter @sdar/catalog-manager test` |
| `G2-P4-B05` 持久化不可变 CatalogSnapshot | P4 注册、Catalog 与 Registry | `pnpm test:catalog` |
| `G2-P4-B06` 实现 Registry Snapshot 构建与持久化 | P4 注册、Catalog 与 Registry | `pnpm test:registry` |
| `G2-P4-B07` 实现 Registry API/Watch/Bootstrap 与 SDAR 适配材料 | P4 注册、Catalog 与 Registry | `pnpm test:registry-e2e` |
| `G2-P4-B08` 完成 Ready→Catalog→Registry 自动编排门禁 | P4 注册、Catalog 与 Registry | `pnpm test:catalog-registry-e2e` |
| `G2-P5-B01` 集成 vendor_managed UGV Runtime 部署 | P5 Provider 集成与交付 | `pnpm test:provider-platform-ugv` |
| `G2-P5-B02` 集成 vendor_managed NPC Tank Runtime 部署 | P5 Provider 集成与交付 | `pnpm test:provider-platform-npc` |
| `G2-P5-B03` 集成 Home Assistant Climate Runtime 部署 | P5 Provider 集成与交付 | `pnpm test:provider-platform-ha` |
| `G2-P5-B04` 实现 PMS Web 基础框架与 Provider 页面 | P5 Provider 集成与交付 | `pnpm --filter @sdar/pms-web test` |
| `G2-P5-B05` 实现配置中心与 Runtime Deployment 页面 | P5 Provider 集成与交付 | `pnpm --filter @sdar/pms-web test` |
| `G2-P5-B06` 实现 Catalog、Registry、Audit 页面 | P5 Provider 集成与交付 | `pnpm --filter @sdar/pms-web test` |
| `G2-P5-B07` 完成平台安全与故障注入测试 | P5 Provider 集成与交付 | `pnpm test:platform-security` |
| `G2-P5-B08` 执行 SDAR 真实/受控 Interop E2E | P5 Provider 集成与交付 | `pnpm test:sdar-interop` |
| `G2-P5-B09` 完成 V0.1 全量验收、发布与交付 | P5 Provider 集成与交付 | `pnpm verify:platform` |
