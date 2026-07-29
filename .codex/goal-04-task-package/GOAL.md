# Goal 04 — Production Lifecycle Closure

## Goal Statement

在 Goal 03 已恢复干净 CI、Docker 基线并修复 RuntimeDeployment Job/状态收敛的前提下，完成 Platform V0.1 剩余生产阻断：通过仓库固定的 PM2 JavaScript API 启动和管理 Runtime，将完整 Runtime 生命周期装配进 PMS Worker，增加周期性持续对账，证明 Worker→数据库准备→Migration→PM2→Runtime→Registration→Catalog→Registry→ACTIVE 的生产链路，并完成平台 CI、版本及发布材料收口。

## Success Criteria

- `@sdar/pm2-runtime-adapter` 固定依赖 `pm2@7.0.3`；
- 真实 PM2 E2E 不再使用 `pnpm dlx pm2` 或绕过生产 Manager；
- 在线 Runtime 的 Version、Config Revision 或 Bootstrap Checksum 漂移会触发受控 restart；
- PMS Worker 使用正式 Composition Root 装配数据库准备、Migration、Secret、Release、PM2、Health、Identity、Catalog/Registry 和 Reconciler；
- Job Registry 只注册 `provider_package.sync` 和唯一的 `runtime_deployment.reconcile`；
- 周期性 Scheduler 使用数据库时间和互斥机制补齐丢失的 Reconcile Job，不产生无限重复 Job；
- 完整生产 E2E 可将 RuntimeDeployment 收敛为 ACTIVE，并验证故障恢复；
- GitHub CI 覆盖 Worker/PM2 Production E2E、Provider 回归和平台最终门禁；
- 根 Monorepo 标识为 Platform 0.1.0，Runtime 组件继续为 2.0.0-rc.1；
- Release Manifest、Evidence、Checksums、SBOM 和 Handoff 不再包含提交占位符；
- Goal 2、Goal 03 的历史状态保持不变；
- 最终形成可审查的 Goal 04 → Goal 03 PR，不自动合并 main 或创建 Tag。

## Non-Goals

- Kubernetes、容器编排平台或跨主机调度；
- 多副本 Runtime 或稳定网关；
- 任意 Shell/远程命令执行；
- 修改 Runtime Task Authority 业务表归属；
- 修改 PMS Migration 001～009；
- 真实 UGV、NPC Tank、Home Assistant 或外部 SDAR 认证；
- 自动合并 `main`；
- 自动创建 Platform V0.1.0 Tag。
