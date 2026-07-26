# Codex Master Goal Prompt

你正在把一个已交付的 MCP Tasks Runtime + Provider 集合升级为 `sdar-mcp-provider-platform`。本任务是长期 Goal 工作，不是一次性代码片段。

## 启动动作

1. 在仓库根目录读取：
   - `.codex/task-package/README.md`
   - `.codex/task-package/EXECUTION_CONTRACT.md`
   - `.codex/task-package/constraints/ARCHITECTURE_GUARDRAILS.md`
   - `.codex/task-package/goal-01/GOAL.md` 或当前激活 Goal 的 `GOAL.md`
   - `.codex/active-goal.json`
2. 运行：

```bash
python3 .codex/task-package/scripts/taskctl.py status
python3 .codex/task-package/scripts/taskctl.py next
```

3. 从系统给出的首个 READY 任务开始，逐张完成任务卡。

## 工作方式

- 先检查代码与测试，再修改；不得根据任务卡标题猜实现。
- 一次只激活一张原子任务卡；不并行修改具有依赖关系的任务。
- 每个任务完成后：运行卡片指定测试、保存证据、更新状态、提交 Git。
- 优先一任务一提交；共享机械修改可以在卡片明确允许时合并。
- 不得为了通过测试删除、跳过、放宽断言、改写冻结协议或降低生产安全默认值。
- 外部环境不可用不等于立即阻断：先执行静态、单元、假实现、已有本地服务和可重复的离线验证；仅在任务验收确实依赖外部条件时按阻断模板记录。
- 不询问已经能从源码、设计或任务包得出的信息；采用最小且可回滚的实现。
- 不提前实现后续 Goal 的能力。发现未来需求时写入 `.codex/decisions.md` 或 backlog，不扩大当前任务范围。

## 强制领域边界

- PMS 是控制面；Runtime 是 Task Authority 与 MCP 数据面；Provider Adapter 是设备与领域执行面。
- PMS 不读取或写入 Runtime Task、Command、Scheduler、Recovery、Outbox 业务表。
- Runtime 不依赖 PMS 数据库，不把 PMS 作为冷启动唯一依赖。
- Provider Adapter 生产默认由供应商管理。
- 同一个逻辑 Provider 的 Runtime 副本共享同一 Runtime Task Authority Database；不同 Provider 不共享同一套无 `provider_id` 隔离的 Task 表。
- PM2 只管理允许列表中的 Runtime 入口；禁止任意脚本、任意 cwd、任意环境变量和任意命令执行。
- Secret 只以 SecretRef 或 `*_FILE` 路径流转，不写入 PM2 Ecosystem、日志、报告或 Git。
- 已交付 Migration 内容不可修改；只能移动、映射、增加新的 Migration。
- Operation Catalog 的正式权威来自 Runtime 的 `server/discover + tools/list`，不是管理员手工输入或 Provider Package 预览。

## 状态与证据

使用：

```bash
python3 .codex/task-package/scripts/taskctl.py start <TASK_ID>
python3 .codex/task-package/scripts/taskctl.py pass <TASK_ID> --evidence '<path-or-command>'
python3 .codex/task-package/scripts/taskctl.py block <TASK_ID> --reason '<reason>'
```

完成任务必须具备：

- 代码或文档变更；
- 卡片要求的验证命令结果；
- `.codex/execution-log.md` 记录；
- 必要 ADR/Decision；
- Git 工作树无意外文件；
- 明确提交。

## 终止条件

仅在当前 Goal 所有任务 PASSED、Goal 验收矩阵通过、Handoff 文件生成且校验通过后，才可宣布 Goal 完成。不得把 `BLOCKED_EXTERNAL` 或部分测试通过描述为完整交付。
