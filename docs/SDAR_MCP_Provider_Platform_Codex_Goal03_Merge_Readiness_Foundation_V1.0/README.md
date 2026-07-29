# SDAR MCP Provider Platform — Codex Goal 03

## Merge Readiness Foundation

本任务包用于在已经完成 PMS API Production Composition 修复之后，处理下一批**规模受控但优先级最高**的合并阻断项。

目标仓库：`zhouwen-giser/sdar-mcp-provider-platform`

工作分支：`codex/goal-03-merge-readiness-foundation`

集成目标分支：`codex/goal-02-runtime-governance`

本 Goal 只有 7 个原子任务，范围限定为：

1. 锁定最新基线和真实 CI 首错；
2. 恢复 Docker Compose 构建与 Runtime 健康检查；
3. 恢复 `pnpm verify:v2`；
4. 将 PMS API Production Gate 纳入 CI；
5. 消除重复的 `runtime_deployment.reconcile` Handler；
6. 修复 RuntimeDeployment 的 ACTIVE/DEGRADED/DISCOVERING 状态收敛；
7. 完成验收、推送和下一 Goal 交接。

明确不做：PM2 生产 Bridge、Worker 全量 Production Composition、周期性 Reconcile Scheduler、完整 Worker→PM2→Runtime E2E、发布元数据和 V0.1 Tag。

## 启动

```bash
unzip SDAR_MCP_Provider_Platform_Codex_Goal03_Merge_Readiness_Foundation_V1.0.zip
cd SDAR_MCP_Provider_Platform_Codex_Goal03_Merge_Readiness_Foundation_V1.0
bash scripts/validate_package.sh
bash scripts/install_goal.sh /absolute/path/to/sdar-mcp-provider-platform
cd /absolute/path/to/sdar-mcp-provider-platform
cat .codex/goal-03-task-package/CODEX_MASTER_PROMPT.md
```

将 `CODEX_MASTER_PROMPT.md` 完整交给 Codex Goal Mode。
