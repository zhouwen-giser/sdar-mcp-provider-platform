# Codex Goal Prompt — Goal 03 Merge Readiness Foundation

你正在仓库 `zhouwen-giser/sdar-mcp-provider-platform` 中执行一个连续但规模受控的 Goal。

目标分支：`codex/goal-03-merge-readiness-foundation`

集成目标：`codex/goal-02-runtime-governance`

## 先执行

```bash
git branch --show-current
git status --short
cat .codex/goal-03-task-package/GOAL.md
cat .codex/goal-03-task-package/EXECUTION_CONTRACT.md
cat .codex/goal-03-task-package/TASK_INDEX.md
python3 .codex/goal-03-task-package/scripts/taskctl.py status
python3 .codex/goal-03-task-package/scripts/taskctl.py next
```

预期首个任务：`G3-P0-B01`。

## 强制阅读顺序

```text
GOAL.md
EXECUTION_CONTRACT.md
references/GITHUB_BASELINE.json
constraints/SCOPE_GUARDRAILS.md
constraints/TEST_AND_CI_RULES.md
constraints/GIT_AND_EVIDENCE_RULES.md
TASK_INDEX.md
当前任务卡
```

## 执行方式

- 按 TASK_GRAPH 依赖连续执行全部 7 个任务；
- 不在任务之间等待人工确认；
- 每任务独立提交并推送；
- 只在真实外部阻断时停止；
- 每个任务先检查现有代码和测试，再做最小修改；
- 不得扩大到 PM2 Production Bridge、Worker 全量 Composition 或发布收口；
- 最终只创建/更新 Goal 03 → Goal 2 的 PR，不合并 `main`。

## 每任务通用命令

```bash
python3 .codex/goal-03-task-package/scripts/taskctl.py start <TASK_ID>
# 实施并验证
python3 .codex/goal-03-task-package/scripts/taskctl.py pass <TASK_ID> --evidence "<commands/results>"
git status --short
git add <task-scoped-files>
git commit -m "<task-card-commit-message>"
git push -u origin codex/goal-03-merge-readiness-foundation
python3 .codex/goal-03-task-package/scripts/taskctl.py next
```

若阻断：

```bash
python3 .codex/goal-03-task-package/scripts/taskctl.py block <TASK_ID> --reason "<reproduction, missing condition, unlock action>"
```

从 `G3-P0-B01` 开始。
