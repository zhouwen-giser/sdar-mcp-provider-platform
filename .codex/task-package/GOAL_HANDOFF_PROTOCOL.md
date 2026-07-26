# Goal Handoff Protocol

## Goal 1 → Goal 2

Goal 1 完成后必须生成：

```text
.codex/handoff/goal1-handoff.json
.codex/handoff/goal1-delivery-report.md
.codex/handoff/goal1-test-evidence.json
```

`goal1-handoff.json` 至少包含：

- `goalId=goal-01`；
- `status=PASSED`；
- 50 个任务全部 PASSED；
- 当前 Git commit；
- source baseline SHA；
- Node/pnpm 版本；
- Runtime frozen protocol 门禁结果；
- Migration isolation 测试结果；
- PMS config Draft/Publish/Pull/Ack/LKG E2E 结果；
- 未关闭风险与外部环境缺口；
- Goal 2 可用的 API、表和 package 清单。

Goal 2 激活条件：

1. Handoff JSON 符合 Schema；
2. Goal 1 task-state 无 BLOCKED/FAILED/IN_PROGRESS；
3. Migration 集合已物理隔离；
4. Runtime Config Client 与 PMS Config API 已形成契约测试；
5. Git 工作树干净；
6. `scripts/verify_goal1_handoff.py` 返回 0。

Goal 2 不得通过复制未完成的 Goal 1 代码或手工修改状态文件绕过门禁。
