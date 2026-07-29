# SDAR MCP Provider Platform — Codex Goal 04 Task Package

## Purpose

在 Goal 03 已恢复合并基线并修复 RuntimeDeployment 对账核心后，完成 V0.1 剩余生产阻断：固定 PM2 生产绑定、PMS Worker Production Composition、周期性对账、Worker→PM2→Runtime 全链路 E2E、平台 CI、版本与发布材料收口。

## Branching

```text
base: origin/codex/goal-03-merge-readiness-foundation
work: codex/goal-04-production-lifecycle-closure
PR:   goal-04 -> goal-03
```

本包不会自动合并 `main`，不会自动创建 V0.1 Tag，也不会声称真实设备或外部 SDAR 已认证。

## Installation

```bash
unzip SDAR_MCP_Provider_Platform_Codex_Goal04_Production_Lifecycle_Closure_V1.0.zip
cd SDAR_MCP_Provider_Platform_Codex_Goal04_Production_Lifecycle_Closure_V1.0
bash scripts/validate_package.sh
bash scripts/install_goal.sh /absolute/path/to/repository
```

安装脚本要求：

- 工作树干净；
- 远端 Goal 03 分支存在；
- Goal 03 的全部任务为 `PASSED`；
- Goal 03 Handoff 已生成；
- 原 Goal 2、Goal 03 状态文件保持不可变。
