# Provider Telemetry Ingress 外部接口

本文面向需要向 SDAR Runtime 上报资源状态和执行进度的外部 Resource Provider（资源提供方）。
协议定义位于
[`provider_telemetry.proto`](../../proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto)。

## 1. 接口定位

`io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress`（Provider 遥测接入服务）是由 Runtime
监听的独立 gRPC Service（gRPC 服务）。它与
`ResourceProviderAdapter`（资源提供方适配器服务）的调用方向相反：

- `ResourceProviderAdapter`：Runtime 调用 Provider，用于查询事实和执行资源副作用；
- `ProviderTelemetryIngress`：Provider 调用 Runtime，用于上报资源事实和执行进度；
- Provider 只需要 Protobuf/gRPC Client（客户端），不需要安装 OpenTelemetry SDK。

当前只有一个 Unary RPC（单次请求/单次响应方法）：

| 英文标识符           | 中文说明               | 完整 gRPC 路径                                                                |
| -------------------- | ---------------------- | ----------------------------------------------------------------------------- |
| `EmitProviderEvents` | 批量上报 Provider 事件 | `/io.sdar.mcp.tasks.telemetry.v1.ProviderTelemetryIngress/EmitProviderEvents` |

## 2. 连接、端口与身份认证

关键配置如下。变量名是部署接口的一部分，中文说明不能替代实际变量名。

| 变量                                 | 中文说明                                  | 默认值      |
| ------------------------------------ | ----------------------------------------- | ----------- |
| `PROVIDER_TELEMETRY_INGRESS_ENABLED` | 是否启用 Provider 遥测 gRPC 监听器        | `false`     |
| `PROVIDER_TELEMETRY_HOST`            | 监听地址                                  | `127.0.0.1` |
| `PROVIDER_TELEMETRY_PORT`            | 监听端口                                  | `7002`      |
| `PROVIDER_TELEMETRY_TLS_MODE`        | 传输安全模式；`required` 表示强制双向 TLS | `disabled`  |
| `PROVIDER_TELEMETRY_TLS_CA_PATH`     | 验证 Provider 客户端证书的 CA 文件        | 未设置      |
| `PROVIDER_TELEMETRY_TLS_CERT_PATH`   | Runtime 服务端证书文件                    | 未设置      |
| `PROVIDER_TELEMETRY_TLS_KEY_PATH`    | Runtime 服务端私钥文件                    | 未设置      |

生产环境启用本接口时必须使用 mTLS（双向 TLS）。Runtime 同时校验以下 Provider 身份：

1. 客户端证书的 Common Name（证书通用名称）；
2. 请求中的 `provider_id`（Provider 标识）；
3. Runtime 配置的 `PROVIDER_ID`（目标 Provider 标识）；
4. 启动时 `ProviderManifest.provider_id`（Provider 清单标识）。

四者必须一致。开发模式可显式使用明文连接，但不得将明文模式用于生产网络。

默认 Kubernetes `Service`（服务）和 `NetworkPolicy`（网络策略）只开放 HTTP 8080。
如果启用本接口，部署方还必须为 `PROVIDER_TELEMETRY_PORT` 增加 Service 端口和仅允许目标
Provider 访问的入站网络规则。

## 3. 请求结构

### 3.1 `EmitProviderEventsRequest`（批量事件请求）

| Proto 字段    | 类型                              | 必填 | 中文说明                              |
| ------------- | --------------------------------- | ---- | ------------------------------------- |
| `provider_id` | `string`                          | 是   | Provider 标识，必须通过身份一致性校验 |
| `events`      | `repeated ProviderTelemetryEvent` | 是   | 事件数组；空数组允许，但没有业务效果  |

### 3.2 `ProviderTelemetryEvent`（Provider 遥测事件）

| Proto 字段                | 类型                         | 中文说明                                                                        |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
| `provider_event_id`       | `string`                     | Provider 生成的事件幂等标识；重试时必须保持不变                                 |
| `provider_event_sequence` | `uint64`                     | Provider 提供的非负事件序号；Runtime 校验数值范围，但当前不跨请求强制连续或单调 |
| `event_type`              | `ProviderTelemetryEventType` | 事件类型枚举，见下表                                                            |
| `resource_id`             | `string`                     | Provider 范围内的资源标识；Resource-only 事件必须提供                           |
| `resource_type`           | `string`                     | 资源类型，例如 `gpu.device`（GPU 设备）                                         |
| `task_id`                 | `string`                     | Runtime Task 标识；`EXECUTION_PROGRESS` 必须提供                                |
| `external_execution_id`   | `string`                     | Provider 执行标识；Task-bound 事件必须与 Runtime 已存事实一致                   |
| `operation_name`          | `string`                     | Operation（操作）名称；Task-bound 事件必须与 Task 一致                          |
| `occurred_at`             | `google.protobuf.Timestamp`  | Provider 事实发生时间；必须是有效时间且位于允许偏移范围内                       |
| `attributes`              | `google.protobuf.Struct`     | 低基数扩展属性；写入前执行递归清洗和大小限制                                    |
| `payload`                 | `google.protobuf.Struct`     | 事件负载；按事件类型使用字段 allowlist（允许列表）                              |
| `traceparent`             | `string`                     | 可选 W3C Trace Context 父级标识                                                 |
| `tracestate`              | `string`                     | 可选 W3C Trace Context 厂商状态，最大 512 字符且禁止换行                        |

### 3.3 事件类型与正式事件名

Proto 使用大写枚举，持久化的 `ProviderOpsEnvelope`（Provider 运维信封）使用 dotted name
（点分名称）。两者映射如下：

| Proto 枚举           | 正式事件名           | 绑定类型                | 中文说明     | `payload` 允许字段                                                           |
| -------------------- | -------------------- | ----------------------- | ------------ | ---------------------------------------------------------------------------- |
| `RESOURCE_STATE`     | `resource.state`     | Resource-only（仅资源） | 资源状态变化 | `state`（状态）、`reasonCode`（原因码）、`attributes`（受限属性）            |
| `RESOURCE_METRIC`    | `resource.metric`    | Resource-only（仅资源） | 资源测量值   | `metricName`（指标名）、`value`（数值）、`unit`（单位）、`quality`（质量）   |
| `RESOURCE_HEALTH`    | `resource.health`    | Resource-only（仅资源） | 资源健康状态 | `health`（健康状态）、`reasonCode`（原因码）                                 |
| `EXECUTION_PROGRESS` | `execution.progress` | Task-bound（绑定 Task） | 执行进度     | `current`（当前值）、`total`（总值）、`percentage`（百分比）、`unit`（单位） |

未知 `payload` 字段会在持久化前丢弃。Provider 不得自行提供
`argumentHash`（参数哈希）、`authorizationContextHash`（授权上下文哈希）、
`executionMode`（执行模式）、`simulationId`（模拟标识）、Adapter/Observation revision
（适配器/观察修订号）等 Runtime 权威字段。

## 4. 输入样例

gRPC 实际使用二进制 Protobuf。以下 JSON 是同一 Protobuf 消息的可读表示，便于外部系统
联调和生成测试夹具。

### 4.1 Resource-only：资源状态和指标

```json
{
  "providerId": "acme-gpu-provider",
  "events": [
    {
      "providerEventId": "gpu-01-state-000042",
      "providerEventSequence": "42",
      "eventType": "RESOURCE_STATE",
      "resourceId": "gpu-01",
      "resourceType": "gpu.device",
      "occurredAt": { "seconds": "1784347200", "nanos": 0 },
      "attributes": { "zone": "cn-east-1a" },
      "payload": {
        "state": "ready",
        "reasonCode": "RESOURCE_READY"
      },
      "traceparent": "",
      "tracestate": ""
    },
    {
      "providerEventId": "gpu-01-utilization-000043",
      "providerEventSequence": "43",
      "eventType": "RESOURCE_METRIC",
      "resourceId": "gpu-01",
      "resourceType": "gpu.device",
      "occurredAt": { "seconds": "1784347201", "nanos": 0 },
      "attributes": {},
      "payload": {
        "metricName": "utilization",
        "value": 0.42,
        "unit": "ratio",
        "quality": "measured"
      },
      "traceparent": "",
      "tracestate": ""
    }
  ]
}
```

### 4.2 Task-bound：执行进度

```json
{
  "providerId": "acme-gpu-provider",
  "events": [
    {
      "providerEventId": "task-progress-000017",
      "providerEventSequence": "17",
      "eventType": "EXECUTION_PROGRESS",
      "resourceId": "gpu-01",
      "resourceType": "gpu.device",
      "taskId": "21e967e4-2e47-4ad1-95dd-ea7bc6d991a2",
      "externalExecutionId": "exec-acme-9817",
      "operationName": "train_model",
      "occurredAt": { "seconds": "1784347220", "nanos": 120000000 },
      "attributes": { "phase": "training" },
      "payload": {
        "current": 40,
        "total": 100,
        "percentage": 40,
        "unit": "steps"
      },
      "traceparent": "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
      "tracestate": "vendor=value"
    }
  ]
}
```

Runtime 会根据 `taskId` 读取已提交 Task，并校验 Provider、执行标识和 Operation 名称；成功后
注入 Runtime 权威上下文。`EXECUTION_PROGRESS` 不能作为 Resource-only 事件上报。

## 5. 响应结构和输出样例

`EmitProviderEventsResponse`（批量事件响应）包含 `results`（逐事件处理结果）。批次中一个事件
失败不会把其他事件自动标记为失败。

| 字段                | 类型     | 中文说明                                           |
| ------------------- | -------- | -------------------------------------------------- |
| `provider_event_id` | `string` | 对应请求事件的幂等标识                             |
| `accepted`          | `bool`   | 是否已接受并持久化，或是否为内容相同的已持久化重试 |
| `duplicate`         | `bool`   | 是否命中内容相同的幂等重试                         |
| `record_id`         | `string` | 接受成功时返回的稳定 Provider Ops Record 标识      |
| `reason_code`       | `string` | 拒绝原因码；成功时为空字符串                       |
| `message`           | `string` | 安全诊断信息；不得依赖其内容做程序分支             |

首次接受：

```json
{
  "results": [
    {
      "providerEventId": "gpu-01-state-000042",
      "accepted": true,
      "duplicate": false,
      "recordId": "f1268d5d-2178-5a0f-a97f-d1507a775d22",
      "reasonCode": "",
      "message": ""
    }
  ]
}
```

使用相同 `provider_event_id` 和完全相同内容重试：

```json
{
  "results": [
    {
      "providerEventId": "gpu-01-state-000042",
      "accepted": true,
      "duplicate": true,
      "recordId": "f1268d5d-2178-5a0f-a97f-d1507a775d22",
      "reasonCode": "",
      "message": ""
    }
  ]
}
```

使用相同事件标识但改变内容：

```json
{
  "results": [
    {
      "providerEventId": "gpu-01-state-000042",
      "accepted": false,
      "duplicate": false,
      "recordId": "",
      "reasonCode": "PROVIDER_EVENT_ID_CONFLICT",
      "message": ""
    }
  ]
}
```

## 6. 拒绝原因码

外部系统必须以 `reason_code`（原因码）而不是 `message`（诊断文本）作为程序判断依据。

| 原因码                                  | 中文含义                                    | 建议处理                      |
| --------------------------------------- | ------------------------------------------- | ----------------------------- |
| `PROVIDER_EVENT_BATCH_TOO_LARGE`        | 批次事件数超过上限                          | 拆分批次后重试                |
| `PROVIDER_EVENT_RATE_LIMITED`           | 当前副本的每分钟事件限额已用尽              | 退避后重试                    |
| `PROVIDER_IDENTITY_MISMATCH`            | 证书、请求、配置或 Task Provider 身份不一致 | 修复身份配置，不要盲目重试    |
| `PROVIDER_EVENT_ID_INVALID`             | 事件标识格式非法                            | 生成 1–256 字符的稳定合法标识 |
| `PROVIDER_EVENT_SEQUENCE_INVALID`       | 事件序号不是非负安全整数                    | 修正序号                      |
| `PROVIDER_EVENT_TYPE_INVALID`           | 事件类型不在允许枚举内                      | 改用受支持类型                |
| `PROVIDER_EVENT_TRACEPARENT_INVALID`    | `traceparent` 不是有效 W3C 格式             | 修正或移除 Trace Context      |
| `PROVIDER_EVENT_TRACESTATE_INVALID`     | `tracestate` 超长或包含换行                 | 修正或移除 Trace Context      |
| `PROVIDER_EVENT_TASK_REQUIRED`          | 执行进度事件缺少 `task_id`                  | 绑定 Runtime Task             |
| `PROVIDER_EVENT_TASK_NOT_FOUND`         | Task 不存在或不可关联                       | 校验 Task 标识和生命周期      |
| `PROVIDER_EVENT_EXECUTION_ID_MISMATCH`  | 外部执行标识与 Task 不一致                  | 使用 Runtime 已绑定执行标识   |
| `PROVIDER_EVENT_OPERATION_MISMATCH`     | Operation 名称与 Task 不一致                | 使用 Task 的 Operation 名称   |
| `PROVIDER_EVENT_RESOURCE_REQUIRED`      | Resource-only 事件缺少资源标识              | 提供 `resource_id`            |
| `PROVIDER_EVENT_RESOURCE_ID_TOO_LONG`   | 资源标识超过长度上限                        | 缩短稳定标识                  |
| `PROVIDER_EVENT_ATTRIBUTE_KEY_TOO_LONG` | 属性键超过长度上限                          | 缩短属性键                    |
| `PROVIDER_EVENT_TOO_LARGE`              | 单事件编码字节数超过上限                    | 缩小属性/负载                 |
| `PROVIDER_EVENT_TOO_DEEP`               | JSON 嵌套深度超过上限                       | 扁平化负载                    |
| `PROVIDER_EVENT_TOO_COMPLEX`            | JSON 节点数超过上限                         | 减少字段/数组元素             |
| `PROVIDER_EVENT_TIMESTAMP_INVALID`      | 发生时间无法解析                            | 发送有效 Protobuf Timestamp   |
| `PROVIDER_EVENT_TIMESTAMP_OUT_OF_RANGE` | 发生时间偏离当前时间过大                    | 校准时钟后重试                |
| `PROVIDER_EVENT_ID_CONFLICT`            | 同一事件标识对应了不同内容                  | 视为数据冲突并人工检查        |
| `PROVIDER_EVENT_PERSISTENCE_FAILED`     | Runtime 未能持久化事件                      | 使用同一事件标识安全重试      |

## 7. 幂等、持久化和故障语义

数据库以 `(provider_id, provider_event_id)`（Provider 标识、事件标识）保证唯一性：

- 相同标识、相同内容：返回原 `record_id`，并设置 `duplicate=true`；
- 相同标识、不同内容：拒绝为 `PROVIDER_EVENT_ID_CONFLICT`；
- Runtime 只有在 `provider_ops_delivery`（Provider 运维持久化投递表）提交后才返回接受成功；
- Collector（采集器）不可用不会回滚业务状态，也不会改变 Runtime readiness（就绪状态）；
- 已接受 Audit（审计）记录保留并重试，Diagnostic（诊断）信号允许在队列压力下丢弃。

gRPC Service 级异常返回 gRPC `INTERNAL`（内部错误）；正常校验失败使用 HTTP 之外的 gRPC
成功响应，并在逐事件 `reason_code` 中表达。

## 8. 客户端生成与参考实现

外部系统应从正式 Proto 生成客户端。仓库参考实现：

- TypeScript：
  [`provider-telemetry.ts`](../../examples/mock-adapter-typescript/src/provider-telemetry.ts)，其中
  `MockProviderTelemetryClient`（模拟 Provider 遥测客户端）提供 `emit`（上报一次）和
  `emitWithDuplicateRetry`（使用同一事件标识重复上报）方法；
- Python：
  [`provider_telemetry.py`](../../examples/mock-adapter-python/provider_telemetry.py)，其中
  `TaskTelemetryBinding`（Task 遥测绑定）封装 Task、外部执行和 Operation 身份，
  `emit_with_duplicate_retry`（上报并执行幂等重试）展示异步 gRPC 调用。

Python 生成示例：

```bash
python -m grpc_tools.protoc \
  -I proto/io/sdar/mcp/tasks/telemetry/v1 \
  --python_out generated \
  --grpc_python_out generated \
  proto/io/sdar/mcp/tasks/telemetry/v1/provider_telemetry.proto
```

生产客户端必须配置受信 CA、客户端证书和客户端私钥；不得把证书私钥、Bearer Token
（持有者令牌）或原始业务 Payload（负载）写入普通日志。
