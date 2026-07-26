# Business Events 可观测性架构

Business Events 遥测补充保持协议事实、运维审计、诊断信号和聚合健康四层分离：

```text
Business Event Log = 协议权威
Provider Ops Audit = 运维审计
OTel Log/Trace = 尽力诊断
Metrics = 聚合健康
```

PostgreSQL 中的 Source Cursor、Inbox、Runtime Sequence、Generation、Continuity 和 Relation
Projection 仍是唯一权威状态。需要持久审计的变更在同一个 PostgreSQL 事务中通过
`BusinessEventProviderOpsRecorder` 写入现有 `provider_ops_delivery`；Recorder 插入失败会回滚该权威事务。
事务提交后，`DurableProviderOpsPublisher` 独立声明并导出审计。Collector 超时、导出失败、Retry 或
Exhausted 不会回滚已提交的 Business Event。

`BusinessEventTelemetryBridge` 是 Business Events 指标、诊断事件和内部 Span 的唯一入口。冻结的 15
项指标同时写入 `RuntimeMetrics`/Prometheus 与 `ProviderTelemetry`/OTLP。每个指标使用精确标签模式；
`sourceId` 只能来自已验证 Manifest 的最多 16 项 Source Roster，未知值归一化为 `other`。Event、Task、
Resource、Projection、Authorization 和 Hash 标识符不得成为指标标签。Observable Gauge 按 Attribute
Series 保存值，因此多个 Source 不会互相覆盖。

Source gRPC Stream 创建 `adapter.rpc.stream_business_events` Client Span，并注入 W3C Trace Context。
Source Connect、Intake、Prepare、Finalize、Rotation、Listen、Replay/Live Batch、Relation Query 和
Operator Rotation 使用短生命周期 Span；不会为 Related Task 建 Span，也不会创建持续数天的 Span。

Business Event 专用 Sanitizer 对 Audit Payload、Diagnostic Body 和 Trace Attribute 分别执行严格
Allowlist。Raw Payload/Envelope、Description、Related Task IDs、Resource Ref、Projection Token、
Authorization Context、Header、Credential、原始异常消息和 Stack 均不会进入遥测边界。

Runtime 不直接写 ClickHouse，也不访问 SDAR `sdar_core`。它只暴露 Prometheus 并通过标准 OTLP 导出；
这项补充维持 `Business Events Runtime Component Conformant`，不自动构成 SDAR ↔ Provider Interop
Certified。
