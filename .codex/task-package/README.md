# SDAR MCP Provider Platform — Codex Full Goal Package V1.0

本包用于将离线交付基线升级为 **SDAR MCP Provider Platform V0.1**。Codex 可以从 Goal 1 直接初始化仓库并开始工作，完成 Goal 1 后通过 Handoff 门禁进入 Goal 2。

## 唯一实现基线

- 文件：`sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip`
- SHA-256：`000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`
- 目标仓库：`sdar-mcp-provider-platform`
- Node.js：`>=22 <23`
- pnpm：`>=11 <12`，优先 `pnpm@11.13.1`

## 两个 Goal

1. **Goal 1 — Platform Foundation**：基线导入、Migration 隔离、Provider Package Registry、共享配置契约、PMS 核心、配置中心、Runtime Config Client。
2. **Goal 2 — Runtime Governance**：RuntimeDeployment、数据库自动准备、PM2 Runtime Adapter、健康与对账、Catalog、Registry、Console 和完整 E2E。

每个 Goal 含 50 张原子任务卡。任务必须按依赖执行；每张任务卡都定义了修改范围、测试、完成证据和推荐提交信息。

## 立即开始

```bash
unzip SDAR_MCP_Provider_Platform_Codex_Full_Goal_Package_V1.0.zip
cd SDAR_MCP_Provider_Platform_Codex_Full_Goal_Package_V1.0
bash scripts/validate_package.sh
bash scripts/bootstrap_goal1.sh /absolute/path/to/sdar-mcp-provider-platform
cd /absolute/path/to/sdar-mcp-provider-platform
cat .codex/task-package/CODEX_MASTER_PROMPT.md
```

把 `CODEX_MASTER_PROMPT.md` 的内容交给 Codex；Codex 必须先运行 `.codex/task-package/scripts/taskctl.py status`，然后从 `G1-P0-B01` 开始。

## Goal 2 切换

Goal 1 全部通过并生成 `.codex/handoff/goal1-handoff.json` 后：

```bash
bash /path/to/package/scripts/prepare_goal2.sh /absolute/path/to/sdar-mcp-provider-platform
```

切换脚本会验证 Goal 1 Handoff、任务状态和关键门禁，不满足条件时拒绝激活 Goal 2。

## 重要边界

- PMS 与 Runtime 同仓但不同进程、不同数据库权威边界。
- PMS 不访问 Runtime Task 表，不代理 MCP 业务流量。
- Runtime 冷启动不能强依赖 PMS；使用 Bootstrap Config 与本地 LKG。
- Runtime 001～023、UGV 024、NPC 025 Migration 必须拆分为独立集合，且不得改写已交付 SQL 语义。
- Provider Adapter 生产默认 `vendor_managed`；平台只管理标准 Runtime。内置 Provider 仅在显式 `platform_managed` 时由平台托管。
- PM2 使用 Fork Mode；PM2 `online` 不等于 Runtime `ready`。
- Runtime 不直接连接 ClickHouse；通过 Collector/Telemetry Gateway。
- 不建设 Kubernetes、跨主机调度、任意脚本执行接口或复杂灰度发布。

## 包结构

- `goal-01/`、`goal-02/`：Goal 说明、任务索引、任务图、50 张原子任务卡。
- `references/`：总体设计、开发计划、离线基线盘点和专项设计。
- `contracts/`：配置、注册、Catalog、Registry、PM2/数据库内部接口合同。
- `schemas/`：ProviderPackage、RuntimeDeployment、配置、Handoff 等 JSON Schema。
- `constraints/`：架构、数据库、Migration、Secret、Git、测试约束。
- `scripts/`：初始化、切换、状态管理、完整性校验脚本。
- `templates/`：Codex 状态、阶段报告、阻断报告、ADR、Handoff 模板。
- `inputs/source/`：原始离线代码基线 ZIP。
