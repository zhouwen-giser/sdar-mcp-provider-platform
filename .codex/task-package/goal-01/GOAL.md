# Goal 1 — Platform Foundation

- Goal ID：`goal-01`
- 原子任务：50
- 估算：约 166 工程人日（不等于 Codex 实际耗时）
- 分支：`codex/goal-01-platform-foundation`

## Goal 结果

把离线母体升级为具备清晰 Migration、Provider Package、共享配置契约、PMS 控制面和 Runtime 配置闭环的平台基础。Goal 1 不实现 PM2 自动启动、RuntimeDeployment、Catalog/Registry 和 Console。

## 阶段

- **P0 基线锁定**：锁定离线交付来源、Git、协议和 Provider 回归。
- **P1 Migration 隔离**：拆分 Runtime/UGV/NPC/PMS Migration 权威与 Runner。
- **P2 Provider Package**：将内置 Provider 组织为可验证、可展示的包集合。
- **P3 共享配置契约**：抽取同源配置定义、Schema、Secret 和 Apply Mode。
- **P4 PMS 核心与持久化**：建立控制面领域、数据库、Worker 基础。
- **P5 API 与配置中心**：完成 Provider 管理和配置 Draft/Publish/Pull/Ack。
- **P6 Runtime Config Client**：完成 Runtime Pull/Watch/LKG 和 Goal 1 Handoff。

## 执行规则

1. 从 `TASK_INDEX.md` 和 `TASK_GRAPH.json` 获取顺序，不按文件名猜依赖。
2. 每次只执行一个 READY 任务。
3. 阶段最后一张任务卡负责阶段门禁和报告。
4. Goal 完成前必须运行 `ACCEPTANCE_CHECKLIST.md`。
5. 不得提前实现下一 Goal 的功能。
