# Execution Contract

1. 一次只执行一个 READY 任务。
2. 每个任务一个独立提交，不得把多个任务合并为一个提交。
3. 不得修改原 `.codex/task-state.json`、Goal 2 Handoff 或原 50 个任务 Evidence。
4. 开始任务前执行 `python3 .codex/goal-03-task-package/scripts/taskctl.py start <TASK_ID>`。
5. 完成任务前必须运行任务卡全部强制验证。
6. 使用 `taskctl.py pass` 或 `taskctl.py block`，不得手工编辑状态。
7. 只有真实外部条件才允许 BLOCKED；代码失败、测试失败和设计缺口必须继续修复。
8. 不得删除测试、改成空测试、加入 `|| true`、跳过 CI 门禁或降低断言。
9. 发现任务卡范围不足时，在 `.codex/goal-03/decisions.md` 记录最小越界理由；不得无边界重构。
10. 每个任务完成后保持 Git 工作树干净，并推送阶段性提交。
11. 若远端 Goal 2 分支在执行期间更新，先完成当前原子任务，再合并最新 Goal 2 分支并完整回归。
12. 不得直接合并 `main`，不得发布 V0.1 Tag。
