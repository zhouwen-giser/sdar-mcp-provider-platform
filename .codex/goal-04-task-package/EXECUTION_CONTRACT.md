# Execution Contract

1. 一次只执行一个 READY 任务。
2. 每个任务一个独立提交，不得把多个任务压成一个提交。
3. 不得修改原 `.codex/task-state.json`、`.codex/goal-03/task-state.json`、Goal 2/Goal 03 Handoff 或历史 Evidence。
4. 开始任务前执行 `taskctl.py start`；完成前运行任务卡全部强制验证。
5. 只能使用 `taskctl.py pass` 或 `taskctl.py block` 改变 Goal 04 状态。
6. 只有真实外部条件才允许 BLOCKED；代码失败、测试失败、缺少 Composition 和设计缺口必须继续修复。
7. 不得删除测试、空实现门禁、加入 `|| true`、降低断言、跳过 CI 或把 Mock 结果包装成生产认证。
8. 发现任务卡范围不足时，只允许最小越界，并在 `.codex/goal-04/decisions.md` 记录原因、文件和回归证据。
9. 每任务完成后保持工作树干净并推送阶段提交。
10. PM2 只允许管理 `sdar-runtime-*`，不得暴露 Shell、任意脚本、任意 cwd 或任意环境变量入口。
11. PMS/Worker 停机不得停止已运行 Runtime；Runtime 冷启动不得依赖 PMS。
12. Secret 只通过 SecretRef 或受控 `*_FILE` 文件传递，不得进入日志、Audit、Evidence、PM2 普通环境或 PR 描述。
13. 不得直接合并 `main`、创建 V0.1 Tag 或声称真实资源/外部 SDAR 已认证。
