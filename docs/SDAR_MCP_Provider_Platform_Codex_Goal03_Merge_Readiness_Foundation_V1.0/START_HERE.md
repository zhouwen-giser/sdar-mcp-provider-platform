# START HERE

1. 运行 `bash scripts/validate_package.sh`。
2. 确保目标仓库工作树干净。
3. 运行 `bash scripts/install_goal.sh <repo-absolute-path>`。
4. 在目标仓库读取 `.codex/goal-03-task-package/CODEX_MASTER_PROMPT.md`。
5. 首个任务必须是 `G3-P0-B01`。

安装脚本不会改写原 Goal 2 的 `.codex/task-state.json`，本 Goal 使用独立目录：

```text
.codex/goal-03/
.codex/goal-03-task-package/
```
