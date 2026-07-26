# Codex Goal：自动完成 SDAR MCP Tasks Provider Runtime V1.0

在当前仓库中，严格按照 `SDAR_MCP_Tasks_Runtime_Codex_Goal_Task_Package_V1.0.md` 连续完成 SDAR MCP Tasks Provider Runtime。

先执行 `/plan`：

1. 阅读任务包和 `references/` 下三份权威文档；
2. 阅读真实仓库、AGENTS.md、PLANS.md、README、CI、代码、迁移和测试；
3. 运行当前基线测试；
4. 创建并持续维护 `docs/implementation/runtime-exec-plan.md` 和需求追踪矩阵；
5. 确认工作分支 `feature/mcp-tasks-provider-runtime-v1`。

随后进入 `/goal`，不要在计划阶段停止。依次完成 R0-R9，每个 Phase 必须：

- 完成可运行代码而非伪代码；
- 补齐对应测试和文档；
- 生成 Phase 报告；
- 独立 commit；
- 立即 push GitHub；
- 同步上游并处理并行冲突；
- 达到退出门槛后继续下一 Phase。

总目标：交付独立部署、TypeScript 实现、PostgreSQL 持久化、gRPC/Protobuf Adapter Protocol、Streamable HTTP MCP Server、完整 SEP-2663/SDAR Profile 生命周期、持久调度、幂等、取消安全语义、Reconcile、合规测试及 TypeScript/Python 双语言 Adapter 验证的 Runtime V1.0 RC。

不要因普通编译、测试、依赖或迁移问题停下。只有缺少凭据、不可逆生产操作或不可消解规范冲突才允许阻塞，并必须写报告。最终只有任务包 Definition of Done 全部满足才可宣告完成。
