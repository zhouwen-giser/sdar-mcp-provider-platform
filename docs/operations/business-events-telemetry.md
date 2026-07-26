# Business Events 遥测运维

Business Events 默认关闭：`BUSINESS_EVENTS_ENABLED=false`。关闭时不会启动 Source Worker、Business
Events 遥测轮询或额外持久循环。启用后，Runtime 在 Worker 创建前尝试初始化 `ProviderTelemetry`，
随后构造有界 Bridge、事务 Recorder、Repository、Manager、Relation Manager 和 Source Worker。

## 信号和排障顺序

1. 先检查 `/health/ready` 的 Business Events 组件和各 Source 状态。
2. 检查 `/metrics` 的 Source 接收/拒绝/阻塞、Publication Barrier、Rotation、Continuity、Replay/Live
   和 Relation 指标。
3. 检查 `telemetry_audit_backlog`、`telemetry_audit_oldest_age_seconds` 与
   `provider_ops_delivery` 的 `PENDING`、`RETRY_WAIT`、`EXHAUSTED` 状态。
4. 使用安全诊断日志与 Span 定位 Source Connect、Intake、Finalize、Rotation、Replay 和 Relation
   阶段；它们不是权威事实，允许在压力或 Collector 故障时丢弃。

`sdar_business_event_publication_barrier_waiting{sourceId}` 在 Worker 启动时为 0，Head Row Pending 时为
1，Ready、Terminal、None、Finalized、Worker Stop 和 Runtime Shutdown 时归零。
`sdar_business_event_inbox_backlog`、`sdar_business_event_oldest_pending_mapping_age_seconds` 和
`sdar_business_event_active_relation_tokens` 在 Prometheus 抓取时从 PostgreSQL 重算，同时更新 OTLP
Gauge，不依赖进程内加减计数。

## 故障语义

- 同事务审计写入失败：权威 Business Event 事务回滚，修复 PostgreSQL/Schema 后重试操作。
- OTLP 初始化失败：Runtime 继续，Prometheus 与 Durable Audit 继续可用。
- Collector/Exporter 失败：Publisher 将已提交审计进入有界退避 Retry；Business Event 权威状态不变。
- Audit Exhausted：保留记录供 Operator 处置，不修改 Cursor、Inbox、Sequence、Generation 或 Relation。
- 指标、日志或 Trace API 抛错：Bridge Fail-open，不修改 MCP Response 或 Business Event 状态。

禁止把 Raw Payload、Description、Task/Resource ID、Projection Token、Authorization Hash、Header、
Credential、原始异常消息或 Stack 临时添加到标签、日志或 Span。需要关联问题时使用稳定、允许的
Reason Code 和聚合计数。

Runtime 不直接写 ClickHouse 或 SDAR `sdar_core`。OTLP Collector 不是 Runtime Readiness 依赖；
Provider Telemetry Ingress 若显式启用，其监听初始化仍按原有配置参与就绪。
