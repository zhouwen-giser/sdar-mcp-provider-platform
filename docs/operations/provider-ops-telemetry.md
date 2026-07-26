# Provider 运维遥测

Runtime v1.1 通过 OTLP/HTTP 导出 Provider 运维遥测，同时保留 Prometheus `/metrics`（指标接口）。遥测不参与 Task、命令派发、安全停止、恢复、Outbox、存活或业务就绪决策。

## 对外边界与配置

- `ProviderTelemetryIngress`（Provider 遥测入口）是 Provider 主动调用 Runtime 的 gRPC 接口；请求、响应、错误码和客户端样例见 [Provider 遥测入口](../protocol/provider-telemetry-ingress.md)。
- `ProviderOpsEnvelope`（Provider 运维事件信封）是 Runtime 向外部 OTLP Collector 导出的稳定产品契约；OTel Log 只是传输载体。
- `/metrics`（Prometheus 指标接口）继续提供拉取式指标。

设置 `OTEL_ENABLED=true`（启用 OTLP）并通过 `OTEL_EXPORTER_OTLP_ENDPOINT`（Collector 基础地址）指定目标。导出器分别追加 `/v1/traces`、`/v1/logs` 和 `/v1/metrics`。生产环境拒绝明文 OTLP；认证请求头只能通过 `OTEL_EXPORTER_OTLP_HEADERS_FILE`（导出请求头文件）提供，mTLS 需要 `OTEL_EXPORTER_OTLP_TLS_MODE=required` 和完整的 CA、客户端证书、私钥文件。

每个信号都携带固定 OTel Resource（资源属性）：`service.name`（服务名）、`service.version`（服务版本）、`service.instance.id`（副本实例标识符）、`deployment.environment`（部署环境）、`sdar.provider.id`（Provider 标识符）和 `sdar.provider.version`（Provider 版本）。每个 Runtime 副本必须使用不同的实例标识符。

## 外部输出样例

```json
{
  "schemaName": "sdar.provider.ops.event",
  "schemaVersion": "1.1.0",
  "recordId": "d56fda7f-f41a-5f54-96c8-0ee0edcb7de5",
  "recordHash": "b7d7d7d865c61c1f13f4caf4dbe88da8ea603e1e3fb90e6729f2e321caa8be28",
  "recordType": "provider.task.lifecycle",
  "eventCategory": "audit",
  "deliveryClass": "durable",
  "providerId": "warehouse-provider",
  "runtimeVersion": "1.1.0",
  "instanceId": "runtime-replica-1",
  "taskId": "59fc754f-47fa-4d8d-9fa8-146abdc47b87",
  "operationName": "inventory.recount",
  "observationRevision": 12,
  "occurredAt": "2026-07-18T03:12:10.000Z",
  "emittedAt": "2026-07-18T03:12:10.120Z",
  "attributes": { "terminal": false },
  "payload": { "previousState": "queued", "currentState": "working" }
}
```

`recordId`（记录标识符）是基于稳定事件身份生成的 UUIDv5；`recordHash`（记录哈希）是 RFC 8785 规范 JSON 的 SHA-256，并排除 `emittedAt`（导出时间）、`instanceId`（副本标识符）等投递期元数据。示例 UUID 和哈希仅展示格式，消费者不得依赖固定值。

## 稳定事件契约

| 标识符                        | 中文解释              | 来源/覆盖范围                                                              |
| ----------------------------- | --------------------- | -------------------------------------------------------------------------- |
| `provider.task.lifecycle`     | Provider 任务生命周期 | 已提交的 Task 状态迁移；覆盖排队、运行、等待、暂停、恢复、停止、终态和过期 |
| `provider.command.lifecycle`  | Provider 命令生命周期 | 命令创建、声明、重试、确认、拒绝、耗尽和取代                               |
| `adapter.rpc`                 | Adapter 远程调用链路  | 真实 gRPC 边界的方法、耗时和状态，不含请求/响应正文                        |
| `provider.scheduler.decision` | Provider 调度决策     | 定时、声明、启动、重试、截止时间和启动窗口结果                             |
| `provider.recovery.lifecycle` | Provider 恢复生命周期 | 逐 Task 协调成功或失败                                                     |
| `provider.ttl.lifecycle`      | Provider TTL 生命周期 | 逐 Task 过期、清除或阻塞                                                   |

Task 生命周期审计记录来自已提交的状态迁移/Outbox 事实，而不是 API Handler（处理器）的意图；事务回滚不会产生生命周期记录。接受的 Provider 事件在 RPC 确认前写入 `provider_ops_delivery`（Provider 运维投递表）。`(providerId, providerEventId)` 在多副本间幂等：相同重试返回相同 `recordId` 且 `duplicate=true`（重复），内容变化则返回 `PROVIDER_EVENT_ID_CONFLICT`（事件标识冲突）。

## 指标

OTel Counter（计数器）包括 `provider_task_transition_total`（任务迁移总数）、`provider_command_total`（命令总数）、`adapter_rpc_total`（Adapter RPC 总数）、`provider_error_total`（Provider 错误总数）和 `provider_recovery_total`（恢复总数）。

自监控 Counter 包括 `telemetry_events_emitted_total`（已发事件总数）、`telemetry_events_dropped_total`（丢弃事件总数）、`telemetry_export_attempt_total`（导出尝试总数）、`telemetry_export_failed_total`（导出失败总数）和 `telemetry_audit_retry_total`（审计重试总数）。Histogram（直方图）包括 `adapter_rpc_duration`、`command_dispatch_duration`、`task_transition_duration` 和 `recovery_duration`，分别表示 Adapter RPC、命令派发、任务迁移和恢复耗时。

Gauge（仪表）包括 `active_tasks`（活动任务数）、`pending_commands`（待处理命令数）、`outbox_pending`（待发布 Outbox 数）、`recovery_backlog`（恢复积压）、`telemetry_queue_depth`（遥测队列深度）、`telemetry_audit_backlog`（审计积压）和 `telemetry_audit_oldest_age_seconds`（最老审计积压秒数）。

指标标签经过白名单和长度限制。未知值归一化为 `other`（其他）；Task、执行、关联、用户、参数哈希和授权哈希绝不能成为指标标签。

## 链路传播

Runtime 为 MCP 调用创建服务端 Span（链路片段），并接受有效的 W3C `traceparent`（父链路上下文）和 `tracestate`（供应商链路状态）。Adapter 客户端 Span 包裹真实 gRPC 调用并注入 W3C 上下文，不记录请求/响应载荷或原始异常。

迁移 018 将 Task 链路标识符、根上下文和关联标识符同时保存到接纳意图与 Task。Scheduler、命令派发器、看门狗和恢复工作在重启后恢复该上下文。Task 关联的 Provider 事件在上下文有效时保留 Provider Span 身份，并把已持久化 Task 链路作为 Link（链路链接），但不能改写 Task 权威状态。

## 隐私和失败语义

Sanitizer（脱敏器）递归移除密码、密钥、Cookie、Token、授权/JWT 材料、原始参数、输入/答案值和 Adapter 载荷，并对对象、数组、Map、Set 和循环引用执行深度、节点、字符串和总字节预算。Provider 事件载荷使用按事件类型定义的字段白名单，未知字段在持久化前删除。

诊断信号使用有界队列、批次和超时；审计事实使用持久化投递表、租约安全声明、有界退避，并且只在导出器确认后标记已投递。Collector 故障不会改变业务或就绪状态，审计记录保持可重试。导出器密钥/初始化失败会产生脱敏告警并禁用遥测。关闭时 Runtime 停止发布循环、强制刷新遥测 Provider，并关闭 Provider 遥测入口。

Business Events 的 Source、Ingest、Publication、Stream、Continuity、Delivery 和 Relation 审计沿用
Envelope `1.1.0` 与同一 `provider_ops_delivery`。必要审计和权威状态同事务提交；导出确认不参与
Business Event 提交条件。运行信号、指标目录与 Operator 处理见
[Business Events 遥测运维](business-events-telemetry.md)。
