# Git and Evidence Rules

- 基线分支：执行时最新的 `origin/codex/goal-02-runtime-governance`；
- Goal 分支：`codex/goal-03-merge-readiness-foundation`；
- 每任务一个提交；
- 每任务更新 `.codex/goal-03/execution-log.md` 和独立 Evidence；
- 不修改原 Goal 2 的任务状态和完成记录；
- 最终创建 Draft PR，base 为 `codex/goal-02-runtime-governance`；
- 所有检查绿色后将 Goal 03 PR 标为 Ready for Review；
- 不自动合并 Goal 03 PR，不直接修改 `main`；
- Evidence 必须包含命令、退出码、测试数量、Commit SHA 和当前分支。
