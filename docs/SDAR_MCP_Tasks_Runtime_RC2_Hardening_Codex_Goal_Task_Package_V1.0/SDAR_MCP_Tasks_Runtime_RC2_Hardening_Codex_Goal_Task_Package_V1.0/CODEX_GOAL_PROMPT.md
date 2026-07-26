# Codex Goal：完成 SDAR MCP Tasks Provider Runtime v1.0.0-rc.2 可靠性修复

在仓库 `zhouwen-giser/sdar-mcp-tasks-provider-runtime` 的现有分支
`feature/mcp-tasks-provider-runtime-v1` 上，连续完成
`SDAR_MCP_Tasks_Runtime_RC2_Hardening_Codex_Goal_Task_Package_V1.0.md`
规定的 H0-H9 全部阶段。

先进入 `/plan`，但计划必须写入仓库并立即继续 `/goal`，不得在计划阶段停止。

必须先执行：

1. `git fetch origin --tags --prune`；
2. 核验当前分支、PR #1、`v1.0.0-rc.1` Tag 和真实 Head；
3. 阅读本任务包、`references/`、仓库现有 ExecPlan、迁移、Task Engine、Scheduler、Recovery、MCP Handler、Adapter Protocol、测试和最终交付报告；
4. 运行当前基线测试并保存结果；
5. 创建并持续维护 `docs/implementation/runtime-rc2-hardening-exec-plan.md` 与 rc.2 追踪矩阵。

总目标：修复 rc.1 审查发现的所有状态机、时间合同、恢复、协议、TTL、可观测性和运维问题，使 Runtime 达到可验证的 rc.2，而不是只新增文档或绕过测试。

强制要求：

- 不删除、不移动或覆盖 `v1.0.0-rc.1` Tag；
- 不 force-push，不重写远程历史，不直接提交 `main`；
- 每个阶段必须有实现、回归测试、阶段报告、独立 commit 和 push；
- 每阶段结束前同步 `origin/main` 和目标远程分支，处理真实冲突；
- 所有外部副作用调用都必须具备持久意图、稳定身份、重试/恢复边界；
- 禁止以 TODO、跳过测试、mock-only、降低断言、隐藏错误或修改报告冒充完成；
- 不得把 cancel/deadline/start-window 的“请求已记录”误当作“资源已安全停止”；
- 不得把 Adapter revision 直接当作 Runtime 全部 Observation revision；
- 不得使用当前 Manifest 恢复绑定旧 Operation Snapshot 的 Task；
- 不得在持有数据库连接或长事务锁时等待慢 Adapter RPC；
- 不得宣称完整 P0-P4，除非扩展后的全部合规矩阵通过。

只有以下条件全部满足才可结束 Goal：

1. H0-H9 Definition of Done 全部通过；
2. 任务包列出的全部回归用例真实运行，无 skip；
3. `pnpm verify`、Buf、Compose、双语言 Adapter 合规测试通过；
4. 新迁移具备升级测试，旧 rc.1 数据可前向升级；
5. PR #1 已更新为 rc.2 范围并且所有检查成功；
6. 创建不可覆盖的 `v1.0.0-rc.2` Tag，且 Tag 指向包含最终报告的已验证提交；
7. `reports/runtime-v1-rc2/final-delivery-report.md` 如实记录仍存在的限制，不得写“零问题”式无证据声明。
