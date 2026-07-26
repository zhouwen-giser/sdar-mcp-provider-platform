# SDAR MCP Tasks Runtime rc.2 Hardening Task Package

本目录是针对 `v1.0.0-rc.1` 代码审查结果生成的 Codex Goal Mode 修复任务包。

## 使用方式

1. 将本目录复制到仓库根目录；
2. 让 Codex 先阅读 `CODEX_GOAL_PROMPT.md`；
3. 先执行 `/plan`，随后立即进入 `/goal`；
4. 以主任务文档的 H0-H9、测试矩阵和 Definition of Done 为唯一完成标准。

## 主要文件

- `CODEX_GOAL_PROMPT.md`：可直接提交给 Codex Goal Mode；
- `SDAR_MCP_Tasks_Runtime_RC2_Hardening_Codex_Goal_Task_Package_V1.0.md`：完整实施任务；
- `REVIEW_FINDINGS_RC1.md`：rc.1 审查缺陷清单；
- `REGRESSION_TEST_MATRIX.md`：必须补齐的测试矩阵；
- `REQUIREMENT_TRACEABILITY_SEED.md`：需求追踪初始表；
- `templates/`：阶段、阻塞和最终交付报告模板；
- `references/`：原始 Profile、Runtime/Adapter 设计和 v1.0 任务包。

## 目标仓库

- Repository: `zhouwen-giser/sdar-mcp-tasks-provider-runtime`
- Working branch: `feature/mcp-tasks-provider-runtime-v1`
- Existing PR: `#1`
- Immutable baseline tag: `v1.0.0-rc.1`
- Target release candidate: `v1.0.0-rc.2`
