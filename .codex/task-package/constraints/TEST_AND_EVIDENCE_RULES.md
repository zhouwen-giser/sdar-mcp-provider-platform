# Test and Evidence Rules

- 现有冻结协议 74/74、Runtime、UGV、NPC、HA 测试是不可弱化基线。
- 每张任务卡指定最小验证；阶段门禁还需运行对应 package 全部测试。
- 环境测试必须输出机器可读证据 JSON，包含 command、exitCode、startedAt、duration、stdout/stderr 摘要。
- Mock 结果只能声明 Component/Mock，不得声明 Real Resource Qualified 或 System Interop Certified。
- E2E 至少覆盖：配置 LKG、PMS 停机、Runtime 崩溃恢复、Adapter 不可达、Migration 失败、Secret 脱敏、Catalog no-op revision。
- 不允许 `it.skip`、弱化断言或改变 fixture 以隐藏回归；临时跳过必须有到期时间和 blocker。
