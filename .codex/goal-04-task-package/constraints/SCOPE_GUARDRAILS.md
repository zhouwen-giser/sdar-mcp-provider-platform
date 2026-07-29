# Scope Guardrails

## Allowed product scope

- PM2 JavaScript API 生产绑定；
-单节点 PM2 Fork Mode；
-PMS Worker Production Composition；
-单节点周期性 RuntimeDeployment 对账；
-现有 Catalog/Registry、Registration、Config、Database Preparation 的生产接线；
-生产生命周期 E2E；
-平台 CI 与发布材料收口。

## Forbidden expansion

- Kubernetes、Nomad、跨主机调度；
-多副本 Runtime、负载均衡或稳定网关；
-新设备协议、新 Provider 类型或新业务 API；
-任意 Shell、任意脚本、任意 cwd、任意远程命令；
-修改已发布 PMS Migration 001～009；
-修改冻结 MCP/SDAR 协议；
-把 PMS 变成 Runtime Task Authority；
-把 Mock/Controlled E2E 声称为真实资源认证。

如发现确需追加 PMS Migration 010，必须先记录 ADR、证明无法通过现有表/事务/Advisory Lock 完成，并停止当前任务等待人工复审；本包默认不允许新增 Migration。
