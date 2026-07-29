# Codex Goal Prompt — Goal 04 Production Lifecycle Closure

你正在仓库 `zhouwen-giser/sdar-mcp-provider-platform` 中执行 V0.1 剩余生产阻断的最终连续 Goal。

目标分支：`codex/goal-04-production-lifecycle-closure`

集成目标：`codex/goal-03-merge-readiness-foundation`

## 先执行

```bash
git branch --show-current
git status --short
cat .codex/goal-04-task-package/GOAL.md
cat .codex/goal-04-task-package/EXECUTION_CONTRACT.md
cat .codex/goal-04-task-package/TASK_INDEX.md
python3 .codex/goal-04-task-package/scripts/taskctl.py status
python3 .codex/goal-04-task-package/scripts/taskctl.py next
```

预期首个任务：`G4-P0-B01`。

## 强制阅读顺序

```text
GOAL.md
EXECUTION_CONTRACT.md
references/GITHUB_BASELINE.json
references/REMAINING_MERGE_BLOCKERS.md
constraints/SCOPE_GUARDRAILS.md
constraints/SECURITY_AND_AUTHORITY_RULES.md
constraints/TEST_AND_CI_RULES.md
constraints/GIT_AND_EVIDENCE_RULES.md
TASK_INDEX.md
当前任务卡
```

## 执行方式

- 按 TASK_GRAPH 依赖连续执行全部 9 个任务；
- 不在任务之间等待人工确认；
- 每个任务独立提交并推送；
- 只在真实外部条件无法由代码解决时停止；
- 每个任务先检查现有实现和 Goal 03 Handoff，再做最小修改；
- 不增加 Kubernetes、跨主机调度、多副本网关或任意远程命令能力；
- 最终只创建/更新 Goal 04 → Goal 03 的 PR，不直接合并 `main`，不创建 Tag。

## 每任务通用命令

```bash
python3 .codex/goal-04-task-package/scripts/taskctl.py start <TASK_ID>
# 实施并验证
python3 .codex/goal-04-task-package/scripts/taskctl.py pass <TASK_ID> --evidence "<commands/results>"
git status --short
git add <task-scoped-files>
git commit -m "<task-card-commit-message>"
git push -u origin codex/goal-04-production-lifecycle-closure
python3 .codex/goal-04-task-package/scripts/taskctl.py next
```

若阻断：

```bash
python3 .codex/goal-04-task-package/scripts/taskctl.py block <TASK_ID> --reason "<reproduction, missing condition, unlock action>"
```

从 `G4-P0-B01` 开始。
