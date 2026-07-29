# Scope Guardrails

## Frozen / Forbidden

- 不修改 `migrations/runtime/**`、`migrations/providers/**` 或 `migrations/pms/001*` 至 `009*`；
- 不修改冻结 MCP Tasks 协议、Business Events 协议或 Adapter Proto；
- 不改变 PMS/Runtime/Provider Adapter 权威边界；
- 不让 PMS 访问 Runtime Task Authority 表；
- 不增加 Kubernetes、跨主机调度、多副本网关；
- 不增加任意命令、任意脚本、任意 cwd 或远程 shell；
- 不实现 PM2 正式 npm Bridge；
- 不实现 Worker 全量 Production Composition；
-不修改 Release Manifest、版本号、Tag；
-不把 Controlled/Mock 结果描述为真实设备认证。

## Allowed Goal Outcomes

- CI 和 Docker 基线恢复；
- CI 增加 PMS API Production Gate；
- Worker Job Type 模型收口；
- RuntimeDeployment Reconciler 的纯应用层状态收敛修复；
-必要的聚焦单元、集成、状态机和 CI 测试。
