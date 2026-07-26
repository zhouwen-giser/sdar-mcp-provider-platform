# Adapter quick start

An Adapter owns resource truth and side effects; Runtime owns MCP, Task, scheduling,
authorization binding and recovery semantics. Start from either
`examples/mock-adapter-typescript` or `examples/mock-adapter-python`. Both use the same
`proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto` and pass the same expanded Adapter protocol
suite.

1. Choose a stable `providerId` and a bounded set of resource-type operations. Resource
   instances belong in arguments; never create one operation per item.
2. Implement `DescribeProvider`, `CheckAvailability`, `StartOperation`, `GetExecution`,
   `RequestCancel`, and `ReconcileExecution`. Implement update, pause/resume, events or inventory
   only when the Manifest declares them.
3. Persist `taskId`, canonical argument hash, authorization-context hash, execution mode/simulation
   id, external execution id, latest Snapshot revision, terminal proof and every command sequence
   in the resource system of record.
4. Make `StartOperation` idempotent by `taskId`. The same identity returns the existing execution;
   a mismatched binding is a conflict. Reconcile performs no side effect.
   Cancel/update/pause/resume acknowledgements are not terminal proof and must be replay-safe by
   command sequence.
5. Increment Snapshot revision monotonically, retain input-request keys until answered, and never
   regress a terminal execution.

Generate TypeScript bindings with `pnpm proto:generate`. The Python image runs `grpcio-tools`
against the same IDL. To validate a reachable implementation, adapt
`scripts/run-conformance.mjs` with its endpoint/process launcher and run:

```bash
TEST_DATABASE_URL=postgresql://... pnpm test:conformance
```

The machine output conforms to `packages/conformance-testkit/report.schema.json` and separates
Adapter protocol, Runtime Profile and resource-specific safety scopes. The reference reports
pass 17 Adapter cases per language, mark Runtime Profile coverage partial, and do not claim
real-resource safety. A production Adapter must additionally qualify its actual side effects,
stop guarantees, authorization, capacity and failure modes.

## Provider 遥测接入（可选）

Provider 不需要集成 OTel SDK。启用 Runtime 的 `ProviderTelemetryIngress`（Provider 遥测入口）后，Provider 可调用 `EmitProviderEvents`（批量提交 Provider 事件）上报资源状态、资源指标、资源健康和执行进度。IDL 位于 `proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto`；调用方向是 Provider → Runtime，与 Runtime → Adapter 的 `ResourceProviderAdapter`（资源 Provider 适配器）方向相反。

TypeScript 示例提供 `MockProviderTelemetryClient`（模拟 Provider 遥测客户端）、`providerTelemetryExampleEvents`（四类示例事件构造器）、`emit`（单次提交）和 `emitWithDuplicateRetry`（重复重试验证）方法。Python 示例提供 `TaskTelemetryBinding`（Task 遥测身份绑定）、`example_events`（示例事件生成函数）和 `emit_with_duplicate_retry`（幂等重试函数）。

最小输入：

```json
{
  "providerId": "mock-provider",
  "events": [
    {
      "providerEventId": "01JZTELEMETRY00000000000001",
      "providerEventSequence": "1",
      "eventType": "RESOURCE_HEALTH",
      "resourceId": "mock-resource-1",
      "resourceType": "mock",
      "occurredAt": "2026-07-18T03:12:10.000Z",
      "payload": { "health": "healthy" }
    }
  ]
}
```

成功输出中的 `accepted`（是否接受）为 `true`，`recordId`（持久化记录标识符）可供外部系统关联审计记录。完整字段、拒绝输出和多语言客户端命令见 [Provider 遥测入口](../protocol/provider-telemetry-ingress.md)。
