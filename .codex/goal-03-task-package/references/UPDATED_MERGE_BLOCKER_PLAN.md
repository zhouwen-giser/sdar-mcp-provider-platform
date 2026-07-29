# Updated Merge Blocker Plan — Goal 03 Extract

本 Goal 从 V2.0 修复计划中提取以下部分：

- G2-FIX-P1：恢复 `verify:v2` 和 Docker Compose 基线；
- G2-FIX-P2 的核心子集：唯一 Reconcile Job Type、ACTIVE/DEGRADED/DISCOVERING 状态收敛；
- G2-FIX-P5 的一个子集：将已经完成的 PMS API Production Gate 纳入 CI。

延期到下一 Goal：

- PM2 固定依赖、JavaScript Bridge 和生产路径 E2E；
- PMS Worker Production Composition；
- Periodic Reconcile Scheduler；
- Worker→PM2→Runtime 全生命周期 E2E；
- Release Metadata 和 PR #2 最终收口。
