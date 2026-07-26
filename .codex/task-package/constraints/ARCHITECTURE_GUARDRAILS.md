# Architecture Guardrails

1. 同一 Monorepo，不同进程：`pms-api`、`pms-worker`、`pms-web`、每个 `mcp-runtime` 独立运行。
2. PMS 只管理期望状态、配置、部署、Catalog、Registry 和审计；不代理 MCP 业务调用。
3. Runtime 保留 Task Authority、Scheduler、Recovery、Command、Notification、Adapter Gateway。
4. Provider Adapter 保留设备连接、Resource 事实、Operation 副作用和设备安全。
5. 依赖方向单向：domain → ports；infra 实现 ports；Runtime core 不依赖 PMS persistence。
6. V0.1 单节点 PM2 Fork Mode；不建设 Kubernetes 或跨节点调度。
7. 同一 Provider 多副本在没有稳定 Gateway 前默认限制为 1；如实现多副本需单独 ADR 与 E2E。
8. Operation Catalog 正式权威是 MCP Discover，不是 Provider Package 静态文件。
