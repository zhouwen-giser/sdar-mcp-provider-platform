# Task Index

| ID | 阶段 | 任务 | 依赖 | 推荐提交 |
|---|---|---|---|---|
| `G2-P0-B01` | P0 Goal 2 预检 | [验证 Goal 1 Handoff 与仓库门禁](tasks/G2-P0-B01.md) | - | `chore(goal2): G2-P0-B01 verify goal 01 handoff` |
| `G2-P0-B02` | P0 Goal 2 预检 | [确认 PM2/PostgreSQL 环境与 Fake 策略](tasks/G2-P0-B02.md) | G2-P0-B01 | `docs(goal2): G2-P0-B02 inventory runtime infrastructure environment` |
| `G2-P0-B03` | P0 Goal 2 预检 | [冻结 Goal 2 领域决策与 ADR](tasks/G2-P0-B03.md) | G2-P0-B01 | `docs(adr): G2-P0-B03 freeze runtime governance decisions` |
| `G2-P0-B04` | P0 Goal 2 预检 | [建立 Goal 2 阶段门禁与报告骨架](tasks/G2-P0-B04.md) | G2-P0-B02, G2-P0-B03 | `chore(goal2): G2-P0-B04 establish governance gates` |
| `G2-P1-B01` | P1 RuntimeDeployment | [定义 RuntimeDeployment 聚合与状态机](tasks/G2-P1-B01.md) | G2-P0-B04 | `feat(runtime-deployment): G2-P1-B01 define deployment aggregate` |
| `G2-P1-B02` | P1 RuntimeDeployment | [定义 RuntimeProcess 投影与实际状态](tasks/G2-P1-B02.md) | G2-P1-B01 | `feat(runtime-deployment): G2-P1-B02 define process projection` |
| `G2-P1-B03` | P1 RuntimeDeployment | [增加 RuntimeDeployment PMS Migration](tasks/G2-P1-B03.md) | G2-P1-B01, G2-P1-B02 | `feat(pms-db): G2-P1-B03 persist runtime deployment` |
| `G2-P1-B04` | P1 RuntimeDeployment | [实现 Deployment Repository 与并发更新](tasks/G2-P1-B04.md) | G2-P1-B03 | `feat(pms-db): G2-P1-B04 implement deployment repositories` |
| `G2-P1-B05` | P1 RuntimeDeployment | [实现 RuntimeDeployment Application Use Cases](tasks/G2-P1-B05.md) | G2-P1-B04 | `feat(pms): G2-P1-B05 add deployment use cases` |
| `G2-P1-B06` | P1 RuntimeDeployment | [实现 RuntimeDeployment 管理 API](tasks/G2-P1-B06.md) | G2-P1-B05 | `feat(pms-api): G2-P1-B06 expose runtime deployments` |
| `G2-P1-B07` | P1 RuntimeDeployment | [实现 RuntimeProcess 查询与日志引用 API](tasks/G2-P1-B07.md) | G2-P1-B04 | `feat(pms-api): G2-P1-B07 expose runtime process status` |
| `G2-P1-B08` | P1 RuntimeDeployment | [完成 RuntimeDeployment 契约与阶段门禁](tasks/G2-P1-B08.md) | G2-P1-B06, G2-P1-B07 | `test(runtime-deployment): G2-P1-B08 close deployment phase` |
| `G2-P2-B01` | P2 数据库自动准备 | [定义 DatabaseProfile 与 SecretRef 模型](tasks/G2-P2-B01.md) | G2-P1-B08 | `feat(database-profile): G2-P2-B01 define database profiles` |
| `G2-P2-B02` | P2 数据库自动准备 | [增加 DatabaseProfile PMS Migration 与 Repository](tasks/G2-P2-B02.md) | G2-P2-B01 | `feat(pms-db): G2-P2-B02 persist database profiles` |
| `G2-P2-B03` | P2 数据库自动准备 | [定义 PostgresProvisioner Port 与错误模型](tasks/G2-P2-B03.md) | G2-P2-B01 | `feat(postgres-provisioner): G2-P2-B03 define provisioning port` |
| `G2-P2-B04` | P2 数据库自动准备 | [实现 PostgreSQL Provisioner](tasks/G2-P2-B04.md) | G2-P2-B02, G2-P2-B03 | `feat(postgres-provisioner): G2-P2-B04 implement database provisioning` |
| `G2-P2-B05` | P2 数据库自动准备 | [实现 File Secret Store Adapter](tasks/G2-P2-B05.md) | G2-P2-B04 | `feat(secret-store): G2-P2-B05 add file secret adapter` |
| `G2-P2-B06` | P2 数据库自动准备 | [实现 Runtime Migration Runner 编排](tasks/G2-P2-B06.md) | G2-P2-B04 | `feat(runtime-migration): G2-P2-B06 add migration orchestration` |
| `G2-P2-B07` | P2 数据库自动准备 | [实现数据库准备 Application Job](tasks/G2-P2-B07.md) | G2-P2-B05, G2-P2-B06 | `feat(pms-worker): G2-P2-B07 orchestrate runtime database setup` |
| `G2-P2-B08` | P2 数据库自动准备 | [增加数据库权限与隔离 E2E](tasks/G2-P2-B08.md) | G2-P2-B07 | `test(database): G2-P2-B08 prove provisioning isolation` |
| `G2-P2-B09` | P2 数据库自动准备 | [完成数据库自动准备阶段门禁](tasks/G2-P2-B09.md) | G2-P2-B08 | `docs(database): G2-P2-B09 close provisioning phase` |
| `G2-P3-B01` | P3 PM2 与运行对账 | [定义 RuntimeInfrastructureAdapter Port](tasks/G2-P3-B01.md) | G2-P2-B09 | `feat(runtime-infra): G2-P3-B01 define infrastructure adapter` |
| `G2-P3-B02` | P3 PM2 与运行对账 | [实现 BootstrapConfigRenderer](tasks/G2-P3-B02.md) | G2-P2-B05, G2-P3-B01 | `feat(pm2-adapter): G2-P3-B02 render bootstrap config` |
| `G2-P3-B03` | P3 PM2 与运行对账 | [实现 PM2 Process Manager 基础封装](tasks/G2-P3-B03.md) | G2-P3-B01 | `feat(pm2-adapter): G2-P3-B03 implement process manager` |
| `G2-P3-B04` | P3 PM2 与运行对账 | [实现 Runtime 版本与入口解析](tasks/G2-P3-B04.md) | G2-P3-B02 | `feat(pm2-adapter): G2-P3-B04 secure runtime release resolution` |
| `G2-P3-B05` | P3 PM2 与运行对账 | [实现端口分配与实例命名](tasks/G2-P3-B05.md) | G2-P1-B02 | `feat(runtime-deployment): G2-P3-B05 allocate instance identity and ports` |
| `G2-P3-B06` | P3 PM2 与运行对账 | [实现 Runtime Start/Stop/Restart/Delete](tasks/G2-P3-B06.md) | G2-P3-B02, G2-P3-B03, G2-P3-B04, G2-P3-B05 | `feat(pm2-adapter): G2-P3-B06 manage runtime lifecycle` |
| `G2-P3-B07` | P3 PM2 与运行对账 | [实现 Runtime Health Probe](tasks/G2-P3-B07.md) | G2-P3-B06 | `feat(runtime-health): G2-P3-B07 probe live and readiness` |
| `G2-P3-B08` | P3 PM2 与运行对账 | [扩展 Runtime Bootstrap 身份与 Secret File 支持](tasks/G2-P3-B08.md) | G2-P3-B02 | `feat(runtime): G2-P3-B08 support platform bootstrap identity` |
| `G2-P3-B09` | P3 PM2 与运行对账 | [实现 RuntimeDeployment Reconcile Worker](tasks/G2-P3-B09.md) | G2-P2-B07, G2-P3-B06, G2-P3-B07 | `feat(pms-worker): G2-P3-B09 reconcile runtime deployments` |
| `G2-P3-B10` | P3 PM2 与运行对账 | [实现崩溃恢复与重启策略](tasks/G2-P3-B10.md) | G2-P3-B09 | `feat(pm2-adapter): G2-P3-B10 add controlled crash recovery` |
| `G2-P3-B11` | P3 PM2 与运行对账 | [实现停止与排空流程](tasks/G2-P3-B11.md) | G2-P3-B09 | `feat(runtime-lifecycle): G2-P3-B11 implement draining and shutdown` |
| `G2-P3-B12` | P3 PM2 与运行对账 | [完成真实 PM2 集成与 P3 门禁](tasks/G2-P3-B12.md) | G2-P3-B07, G2-P3-B08, G2-P3-B10, G2-P3-B11 | `test(pm2-adapter): G2-P3-B12 close PM2 runtime phase` |
| `G2-P4-B01` | P4 注册、Catalog 与 Registry | [定义 Runtime Registration 与 Heartbeat 模型](tasks/G2-P4-B01.md) | G2-P3-B12 | `feat(runtime-registration): G2-P4-B01 define registration model` |
| `G2-P4-B02` | P4 注册、Catalog 与 Registry | [实现 Runtime Registration/Heartbeat API 与 Client](tasks/G2-P4-B02.md) | G2-P4-B01 | `feat(runtime-registration): G2-P4-B02 connect runtime heartbeat` |
| `G2-P4-B03` | P4 注册、Catalog 与 Registry | [实现 Provider 身份三方校验](tasks/G2-P4-B03.md) | G2-P4-B02 | `feat(provider-identity): G2-P4-B03 enforce identity consistency` |
| `G2-P4-B04` | P4 注册、Catalog 与 Registry | [实现 Catalog Discovery Client 与验证](tasks/G2-P4-B04.md) | G2-P4-B03 | `feat(catalog): G2-P4-B04 discover runtime catalog` |
| `G2-P4-B05` | P4 注册、Catalog 与 Registry | [持久化不可变 CatalogSnapshot](tasks/G2-P4-B05.md) | G2-P4-B04 | `feat(catalog): G2-P4-B05 persist catalog snapshots` |
| `G2-P4-B06` | P4 注册、Catalog 与 Registry | [实现 Registry Snapshot 构建与持久化](tasks/G2-P4-B06.md) | G2-P4-B05 | `feat(registry): G2-P4-B06 build registry snapshots` |
| `G2-P4-B07` | P4 注册、Catalog 与 Registry | [实现 Registry API/Watch/Bootstrap 与 SDAR 适配材料](tasks/G2-P4-B07.md) | G2-P4-B06 | `feat(registry-api): G2-P4-B07 expose registry snapshots` |
| `G2-P4-B08` | P4 注册、Catalog 与 Registry | [完成 Ready→Catalog→Registry 自动编排门禁](tasks/G2-P4-B08.md) | G2-P4-B07 | `test(catalog-registry): G2-P4-B08 close discovery publication phase` |
| `G2-P5-B01` | P5 Provider 集成与交付 | [集成 vendor_managed UGV Runtime 部署](tasks/G2-P5-B01.md) | G2-P4-B08 | `test(platform): G2-P5-B01 integrate UGV provider` |
| `G2-P5-B02` | P5 Provider 集成与交付 | [集成 vendor_managed NPC Tank Runtime 部署](tasks/G2-P5-B02.md) | G2-P4-B08 | `test(platform): G2-P5-B02 integrate NPC tank provider` |
| `G2-P5-B03` | P5 Provider 集成与交付 | [集成 Home Assistant Climate Runtime 部署](tasks/G2-P5-B03.md) | G2-P4-B08 | `test(platform): G2-P5-B03 integrate climate provider` |
| `G2-P5-B04` | P5 Provider 集成与交付 | [实现 PMS Web 基础框架与 Provider 页面](tasks/G2-P5-B04.md) | G2-P1-B07 | `feat(pms-web): G2-P5-B04 add provider management UI` |
| `G2-P5-B05` | P5 Provider 集成与交付 | [实现配置中心与 Runtime Deployment 页面](tasks/G2-P5-B05.md) | G2-P5-B04, G2-P1-B06 | `feat(pms-web): G2-P5-B05 add config and runtime UI` |
| `G2-P5-B06` | P5 Provider 集成与交付 | [实现 Catalog、Registry、Audit 页面](tasks/G2-P5-B06.md) | G2-P5-B05, G2-P4-B07 | `feat(pms-web): G2-P5-B06 add catalog registry audit UI` |
| `G2-P5-B07` | P5 Provider 集成与交付 | [完成平台安全与故障注入测试](tasks/G2-P5-B07.md) | G2-P5-B01, G2-P5-B02, G2-P5-B03 | `test(platform): G2-P5-B07 harden security and recovery` |
| `G2-P5-B08` | P5 Provider 集成与交付 | [执行 SDAR 真实/受控 Interop E2E](tasks/G2-P5-B08.md) | G2-P4-B07, G2-P5-B01 | `test(interop): G2-P5-B08 verify SDAR integration` |
| `G2-P5-B09` | P5 Provider 集成与交付 | [完成 V0.1 全量验收、发布与交付](tasks/G2-P5-B09.md) | G2-P5-B06, G2-P5-B07, G2-P5-B08 | `chore(release): G2-P5-B09 deliver provider platform v0.1` |
