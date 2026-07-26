# Runtime 外部接口参考

本文汇总 Runtime 暴露给 MCP Client（MCP 客户端）、运维系统和 Resource Provider（资源提供方）
的接口。所有英文方法名、字段名和类名均为协议标识符，调用时必须保持原样。

## 1. HTTP 接口

| 方法与路径               | 中文用途                                              | 主要调用方                                          |
| ------------------------ | ----------------------------------------------------- | --------------------------------------------------- |
| `POST /mcp`              | MCP Streamable HTTP（流式 HTTP）JSON-RPC 入口         | MCP Client                                          |
| `GET /health/live`       | 进程存活检查                                          | Kubernetes liveness probe（存活探针）               |
| `GET /health/ready`      | 依赖和 Worker 就绪检查                                | Kubernetes readiness/startup probe（就绪/启动探针） |
| `GET /metrics`           | Prometheus 文本指标                                   | Prometheus 或兼容采集器                             |
| `GET /internal/provider` | 查看启动时已验证的 Provider Manifest（Provider 清单） | 受控运维系统                                        |

### 1.1 `GET /health/live`（存活检查）

输入：无请求体。

成功输出：

```json
{ "status": "live" }
```

### 1.2 `GET /health/ready`（就绪检查）

就绪时返回 HTTP 200；任一强依赖未就绪时返回 HTTP 503。OTLP Collector（遥测采集器）和
Provider Ops Audit backlog（审计积压）不是就绪依赖；启用后的
`providerTelemetryIngress`（Provider 遥测接入监听器）是启动/就绪依赖。

```json
{
  "status": "ready",
  "dependencies": {
    "database": "ready",
    "adapter": "ready",
    "adapterManifest": "ready",
    "recovery": "ready",
    "scheduler": "ready",
    "commandDispatcher": "ready",
    "ttlCleaner": "ready",
    "outboxPublisher": "ready",
    "outboxCleaner": "ready",
    "providerTelemetryIngress": "ready"
  }
}
```

### 1.3 `GET /internal/provider`（内部 Provider 清单）

必须设置 `INTERNAL_ENDPOINTS_ENABLED=true`（启用内部接口）和至少 32 字符的
`INTERNAL_ADMIN_TOKEN`（内部管理令牌）。请求头使用
`x-sdar-admin-token`（SDAR 管理令牌头）。

```http
GET /internal/provider HTTP/1.1
Host: runtime.example.internal
x-sdar-admin-token: replace-with-secret-admin-token
```

典型错误输出：

```json
{ "error": "admin_token_required" }
```

`internal_endpoints_disabled`（内部接口未启用）返回 404，`admin_token_required`（缺少令牌）
返回 401，`invalid_admin_token`（令牌错误）返回 403，`manifest_not_loaded`（清单尚未加载）
返回 503。

## 2. `POST /mcp` JSON-RPC 接口

该端点是 stateless（无会话状态）的。每个 POST 请求独立处理，不返回 `Mcp-Session-Id`
（MCP 会话标识），也不提供 HTTP GET/DELETE 会话生命周期或 SSE 恢复。

支持的方法：

| 方法标识符                                | 中文说明                                                    |
| ----------------------------------------- | ----------------------------------------------------------- |
| `initialize`                              | 初始化 MCP 协议和能力协商                                   |
| `tools/list`                              | 列出由 Provider Manifest 生成的 Tool（工具）                |
| `tools/call`                              | 调用一个 Tool；可能直接返回结果或创建 Task                  |
| `tasks/get`                               | 获取 Task 当前快照和最多 100 条最新 Observation（观察记录） |
| `tasks/result`                            | 获取终态 Task 结果                                          |
| `tasks/cancel`                            | 持久化取消请求；确认接收不代表 Task 已终止                  |
| `tasks/update`                            | 回答 Task Input Request（输入请求）并返回命令接收凭据       |
| `tasks/observations`                      | 分页读取 Task Observation 历史                              |
| `io.sdar/taskExecution/checkAvailability` | 批量查询 Operation（操作）可用性                            |
| `io.sdar/taskExecution/tasks/pause`       | 请求暂停支持该能力的 Task                                   |
| `io.sdar/taskExecution/tasks/resume`      | 请求恢复支持该能力的 Task                                   |

### 2.1 通用调用样例

```http
POST /mcp HTTP/1.1
Host: runtime.example.internal
Content-Type: application/json
Authorization: Bearer replace-with-jwt

{
  "jsonrpc": "2.0",
  "id": "request-1001",
  "method": "tasks/get",
  "params": {
    "taskId": "21e967e4-2e47-4ad1-95dd-ea7bc6d991a2"
  }
}
```

`AUTH_MODE=trusted_headers`（受信代理头认证）时，认证代理必须清除客户端伪造值并设置
`x-sdar-subject`（主体）、`x-sdar-tenant`（租户）；`AUTH_MODE=jwt_hs256` 时使用
`Authorization: Bearer ...`（持有者令牌）。

### 2.2 `tasks/observations`（Observation 分页）

输入字段：

| 字段     | 类型         | 必填 | 中文说明                                         |
| -------- | ------------ | ---- | ------------------------------------------------ |
| `taskId` | UUID string  | 是   | 目标 Task 标识；同时执行授权上下文校验           |
| `cursor` | 正整数字符串 | 否   | 不透明分页游标；读取 revision 小于该值的更早记录 |
| `limit`  | integer      | 否   | 每页数量，范围 1–100，默认 100                   |

第一页输入：

```json
{
  "jsonrpc": "2.0",
  "id": "observations-page-1",
  "method": "tasks/observations",
  "params": {
    "taskId": "21e967e4-2e47-4ad1-95dd-ea7bc6d991a2",
    "limit": 2
  }
}
```

成功输出：

```json
{
  "jsonrpc": "2.0",
  "id": "observations-page-1",
  "result": {
    "taskId": "21e967e4-2e47-4ad1-95dd-ea7bc6d991a2",
    "observations": [
      {
        "revision": 12,
        "type": "task.progress",
        "occurredAt": "2026-07-18T04:30:00.000Z",
        "message": "Training 40% complete.",
        "substate": "running",
        "progress": { "current": 40, "total": 100, "unit": "steps" },
        "source": "adapter",
        "adapterRevision": 8
      },
      {
        "revision": 11,
        "type": "task.command.acknowledged",
        "occurredAt": "2026-07-18T04:29:40.000Z",
        "reasonCode": "UPDATE_ACCEPTED",
        "source": "runtime"
      }
    ],
    "_meta": {
      "observationCursor": "11",
      "hasMore": true
    }
  }
}
```

下一页必须原样使用返回的 `observationCursor`（Observation 游标）：

```json
{
  "jsonrpc": "2.0",
  "id": "observations-page-2",
  "method": "tasks/observations",
  "params": {
    "taskId": "21e967e4-2e47-4ad1-95dd-ea7bc6d991a2",
    "cursor": "11",
    "limit": 2
  }
}
```

当 `hasMore=false`（没有更多数据）时，`observationCursor` 为 `null`。客户端不得解析或自行
计算游标语义。

### 2.3 JSON-RPC 错误样例

```json
{
  "jsonrpc": "2.0",
  "id": "observations-page-2",
  "error": {
    "code": -32602,
    "message": "Invalid request parameters.",
    "data": { "reasonCode": "OBSERVATION_CURSOR_INVALID" }
  }
}
```

外部系统应使用 `error.data.reasonCode`（稳定原因码）做程序判断，不应依赖英文
`message`（安全诊断文本）。未知、越权或已隐藏 Task 使用相同 not-found（未找到）行为，
避免泄露 Task 是否存在。

## 3. Adapter gRPC v1

`io.sdar.mcp.tasks.adapter.v1.ResourceProviderAdapter`（资源提供方适配器服务）由 Provider
实现、Runtime 调用。权威字段定义见
[`adapter.proto`](../../proto/io/sdar/mcp/tasks/adapter/v1/adapter.proto)。

| RPC 方法                             | 要求 | 中文契约                                           |
| ------------------------------------ | ---- | -------------------------------------------------- |
| `DescribeProvider`                   | 必须 | 返回版本化 Provider Manifest 和有限 Operation 目录 |
| `CheckAvailability`                  | 必须 | 批量返回四态可用性预测，不产生资源副作用           |
| `StartOperation`                     | 必须 | 按稳定 Task 身份幂等启动 Operation                 |
| `GetExecution`                       | 必须 | 返回当前权威 Execution Snapshot（执行快照）        |
| `RequestCancel`                      | 必须 | 返回可重放的取消 Ack（确认）；不是终态证明         |
| `ReconcileExecution`                 | 必须 | 无副作用地返回 FOUND/NOT_FOUND/TRANSIENT/CONFLICT  |
| `UpdateExecution`                    | 条件 | 提交 Input Answer（输入答案）和稳定命令序号        |
| `PauseExecution` / `ResumeExecution` | 条件 | 返回可重放的暂停/恢复确认                          |
| `StreamExecutionEvents`              | 可选 | 事件优化通道；轮询和 Reconcile 仍是可靠性基线      |
| `ListResources`                      | 可选 | 资源清单；不得动态改变 Tool 数量                   |

生成的 TypeScript binding（绑定代码）必须通过 `pnpm proto:check` 漂移检查。删除字段、重新
编号或改变身份语义需要新的协议 major version（主版本）。

## 4. Provider Telemetry gRPC

`io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress`（Provider 遥测接入服务）由 Runtime
实现、Provider 调用。它不属于 `ResourceProviderAdapter`，也不要求 Provider 使用 OTel SDK。

完整字段、mTLS、输入/输出、幂等重试和错误码说明见
[Provider Telemetry Ingress 外部接口](provider-telemetry-ingress.md)。

## 5. Task 结果和保留语义

- `ttl`（Task 句柄保留毫秒数）控制查询句柄保留，不是执行 Deadline（截止时间）；
- `pollInterval`（建议轮询间隔）不控制调度或最长执行时间；
- 活跃 Task 不会因 TTL 到期而被删除；终态 Task 保留至 `terminalAt + ttl`；
- 同步、异步、部分结果和业务失败都执行输出 Schema（模式）、1 MiB、深度 32、节点 10,000
  限制；
- `BUSINESS_FAILED`（业务失败）和 partial（部分完成）使用 `isError=true` 的 Tool 结果，
  技术失败使用 MCP Task `failed`；
- 非终态 `tasks/get` 遇到瞬时 Adapter 故障时返回最后持久化快照，并在
  `_meta["io.sdar/taskExecution"]` 中标记 `snapshotFreshness="stale"`（快照已陈旧）。

## 6. 验证边界

`pnpm verify:v1.1`（v1.1 完整验证命令）聚合格式、静态检查、Proto、迁移、单元/集成/恢复/
安全/E2E、双语言 conformance（符合性）和容量基线。参考 Adapter 报告只证明参考实现的
协议符合性；真实 Provider 仍必须单独证明资源副作用幂等性、安全停止和容量上限。
