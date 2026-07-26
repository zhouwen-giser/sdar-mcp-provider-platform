# Quick Start：使用 Codex Goal Mode 执行 Runtime 任务包

## 1. 放入目标仓库

将本任务包目录完整复制到目标仓库根目录，至少保留：

```text
SDAR_MCP_Tasks_Runtime_Codex_Goal_Task_Package_V1.0.md
CODEX_GOAL_PROMPT.md
references/
templates/
```

## 2. 启动 Codex

先让 Codex 读取仓库与任务包并进入计划模式。计划必须写入仓库，而不是只显示在聊天窗口。

随后进入 Goal Mode，将 `CODEX_GOAL_PROMPT.md` 全文作为 Goal。

## 3. 执行期间检查

Codex 应当持续完成 R0-R9，并在每阶段后产生：

```text
reports/runtime-v1/phase-RN/
Git commit
GitHub push
更新后的 ExecPlan/traceability
```

不要在只有设计、接口或骨架时接受“完成”。最终以任务包 Definition of Done、`pnpm verify`、跨语言 E2E 和 GitHub 提交证据为准。
