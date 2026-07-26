# Goal 2 — Runtime Governance and Delivery

- Goal ID：`goal-02`
- 原子任务：50
- 估算：约 270 工程人日（不等于 Codex 实际耗时）
- 分支：`codex/goal-02-runtime-governance`

## Goal 结果

在 Goal 1 控制面和配置闭环上实现数据库自动准备、PM2 Runtime 生命周期、期望状态对账、正式 Catalog/Registry、三个 Provider 集成、Console、安全和 V0.1 发布。

## 阶段

- **P0 Goal 2 预检**：验证 Goal 1 Handoff 并固定运行治理决策。
- **P1 RuntimeDeployment**：建立期望/实际状态、持久化和管理 API。
- **P2 数据库自动准备**：实现 Profile、Provisioner、Secret、Migration 编排。
- **P3 PM2 与运行对账**：实现安全 PM2 管理、健康、Reconcile 和恢复。
- **P4 注册、Catalog 与 Registry**：完成实例身份、正式发现和 SDAR 发布。
- **P5 Provider 集成与交付**：集成三个 Provider、Console、安全、Interop 和发布。

## 执行规则

1. 从 `TASK_INDEX.md` 和 `TASK_GRAPH.json` 获取顺序，不按文件名猜依赖。
2. 每次只执行一个 READY 任务。
3. 阶段最后一张任务卡负责阶段门禁和报告。
4. Goal 完成前必须运行 `ACCEPTANCE_CHECKLIST.md`。
5. 不得提前实现下一 Goal 的功能。
