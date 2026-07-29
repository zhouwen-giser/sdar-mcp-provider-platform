# Git and Evidence Rules

- Base：`origin/codex/goal-03-merge-readiness-foundation`。
- Work：`codex/goal-04-production-lifecycle-closure`。
- 每任务一个提交，并推送后再开始下一任务。
- 不得修改 Goal 2、Goal 03 的 task-state、Handoff、Evidence 和完成时间。
- 每个 Evidence 必须记录命令、退出码、测试数、关键环境版本和 Commit SHA。
- Evidence 不得只写 `all tests passed`。
- 任何范围外改动必须记录在 `.codex/goal-04/decisions.md`。
- 最终只创建/更新 Goal 04 → Goal 03 PR；不得直接合并 main。
- 不得自动创建 Tag。Tag 必须在人工 Review、父分支整合和最终 Required Checks 后由发布动作创建。
