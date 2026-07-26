# 可观测性架构

Runtime v1.1 将业务事实、持久化审计投递、尽力而为的诊断信号和指标明确分离。遥测链路不依赖 SDAR Core 或 ClickHouse，也不参与 Task（任务）、Command（命令）、Outbox（发件箱）、存活或就绪决策。

1. 已提交的 Task/Command 状态迁移、Provider 入口事件，以及逐任务的 Scheduler（调度）、Recovery（恢复）和 TTL（生存期）事实，都会形成规范的 `ProviderOpsEnvelope`（Provider 运维事件信封）。
2. 审计类记录与其权威业务事实在同一事务中写入 `provider_ops_delivery`（Provider 运维投递表）。多个副本通过租约声明记录；仅在导出器确认后标记为已投递，超时或 Collector（收集器）失败则进入有界退避重试。
3. 诊断日志与链路使用有界内存队列，压力过大时允许丢弃。它们可以解释执行过程，但不能替代持久化审计契约。
4. Prometheus 与 OTLP 指标只使用固定仪表和有界标签。未知值映射为 `other`（其他）；Task、执行、用户、关联标识符和哈希禁止用作标签。

规范记录类型使用点分英文标识符：`provider.task.lifecycle`（任务生命周期）、`provider.command.lifecycle`（命令生命周期）、`provider.scheduler.decision`（调度决策）、`provider.recovery.lifecycle`（恢复生命周期）和 `provider.ttl.lifecycle`（TTL 生命周期）。`recordId`（记录标识符）由稳定业务事件键生成；`recordHash`（记录哈希）不含副本身份和投递时间，因此另一副本重放时结果一致。

MCP HTTP 操作创建 W3C 服务端 Span（链路片段）。Adapter Span 包裹真实 gRPC 调用并传播 `traceparent`（父链路上下文）和 `tracestate`（供应商链路状态）。Task 根上下文会持久化，使调度器、派发器、看门狗和恢复工作在重启后仍能恢复链路。Task 关联的 Provider 事件只把 Provider Span 链接到持久化 Task 链路，不能改写 Task 权威状态。

Sanitizer（脱敏器）是导出边界：凭证类字段、自由文本、原始参数/结果、Adapter 载荷、未知 Provider 字段、原始异常消息和堆栈都会被移除。深度、节点、字符串和总字节预算同时覆盖数组、Map、Set 与循环引用。

生产环境启用 OTLP 时必须使用 HTTPS。请求头和 mTLS 材料从 Secret 挂载文件读取且只传给导出器。初始化或导出失败会产生不含密钥的告警；审计事实保持可重试，而且 OTLP Collector 故障不会改变 Runtime 就绪状态。Provider 遥测入口是独立的 gRPC 服务，启用后其监听与 mTLS 初始化属于就绪检查。

Business Events 使用同一套 Provider Ops Outbox 和 OTel Provider，不建立第二套持久通道。其严格
有界 Metric Bridge、事务审计、流式 gRPC Trace 和专用脱敏边界见
[Business Events 可观测性架构](business-events-observability.md)。
