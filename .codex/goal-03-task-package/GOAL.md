# Goal 03 — Merge Readiness Foundation

## Goal Statement

在不扩展 V0.1 产品范围、不削弱现有 Runtime/Provider 门禁的前提下，恢复 PR #2 的干净 CI 与 Docker 基线，并修复 RuntimeDeployment 对账核心中已经确认的重复 Job Type 和状态不收敛问题。

## Success Criteria

- `pnpm verify:v2` 在干净 PostgreSQL 环境通过；
- `docker compose build runtime adapter-typescript` 通过；
-基础 Runtime Compose 可启动并通过 `/health/ready`；
- CI 新增并通过 PMS API Production Gate；
-外部 Job Type 只保留一个 `runtime_deployment.reconcile`；
- `ACTIVE` 健康失败可转为 `DEGRADED`；
- `DEGRADED` 恢复后可重新进入 `DISCOVERING`，并由 Catalog/Registry Phase 收口为 `ACTIVE`；
-不修改已发布 Migration；
-不污染 Goal 2 原 50 个任务状态；
-所有任务独立提交，最终形成可合并到 Goal 2 分支的 Goal 03 PR。

## Non-Goals

- PM2 npm 依赖和 JavaScript Bridge；
- PM2 配置漂移重启；
- PMS Worker Production Composition；
-周期性扫描和持续调度；
-全链路 Worker→PM2→Runtime E2E；
-根包版本和 Release Manifest 修订；
-合并到 `main` 或发布 Tag。
