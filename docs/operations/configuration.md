# Runtime 配置参考

Runtime（运行时）启动时读取一次环境变量，并在监听端口前完成校验。无效值会使启动失败；生产环境不会在已要求 `mTLS`（双向 TLS）或 `JWT`（JSON Web Token）认证时降级运行。

| 变量（英文标识符）                             | 默认值                  | 中文说明                                            |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------- |
| `HOST` / `PORT`                                | `0.0.0.0` / `8080`      | HTTP 监听地址和端口                                 |
| `LOG_LEVEL`                                    | `info`                  | Pino 结构化日志级别                                 |
| `RUNTIME_ENV`                                  | `development`           | 运行环境：开发、测试或失败关闭的生产模式            |
| `PROVIDER_ID`                                  | `mock-provider`         | Provider 标识符，必须与 Adapter Manifest 完全一致   |
| `DATABASE_URL`                                 | local development URL   | PostgreSQL 连接 URI；生产环境必须使用 Secret        |
| `DATABASE_POOL_MAX`                            | `10`                    | 每个 Runtime 副本的连接池上限，范围 1–100           |
| `ADAPTER_ENDPOINT`                             | `127.0.0.1:7001`        | Adapter 的固定 `主机:端口` gRPC 地址                |
| `ADAPTER_RPC_TIMEOUT_MS`                       | `5000`                  | 单次 Adapter RPC 超时，范围 1–60,000 毫秒           |
| `COMMAND_CLAIM_LEASE_MS`                       | `30000`                 | 命令派发声明租约，范围 1,000–300,000 毫秒           |
| `SCHEDULE_CLAIM_LEASE_MS`                      | `30000`                 | 定时启动声明租约，范围 1,000–300,000 毫秒           |
| `RECOVERY_LEASE_MS`                            | `30000`                 | 恢复协调租约，范围 1,000–300,000 毫秒               |
| `LEASE_SAFETY_MARGIN_MS`                       | `500`                   | 租约安全余量，范围 100–60,000 毫秒                  |
| `DB_PUBLICATION_BUDGET_MS`                     | `1000`                  | 数据库提交和发布预算，范围 100–60,000 毫秒          |
| `ADAPTER_TLS_MODE`                             | `disabled`              | Adapter TLS 模式；`required` 表示强制双向 TLS       |
| `ADAPTER_TLS_CA_PATH`                          | unset                   | 用于校验 Adapter 的 PEM CA 证书包路径               |
| `ADAPTER_TLS_CERT_PATH`                        | unset                   | Runtime 访问 Adapter 的 PEM 客户端证书路径          |
| `ADAPTER_TLS_KEY_PATH`                         | unset                   | Runtime 访问 Adapter 的 PEM 客户端私钥路径          |
| `AUTH_MODE`                                    | `development`           | 认证模式：开发、可信请求头或 HS256 JWT              |
| `JWT_HS256_SECRET`                             | unset                   | HS256 JWT 密钥，至少 32 个字符                      |
| `JWT_ISSUER` / `JWT_AUDIENCE`                  | unset                   | 可选的 JWT 签发者和受众精确约束                     |
| `HTTP_BODY_LIMIT_BYTES`                        | `1048576`               | Fastify HTTP 请求体上限，范围 1 KiB–16 MiB          |
| `ARGUMENT_MAX_BYTES`                           | `1048576`               | Tool 参数 JSON 的字节上限                           |
| `ARGUMENT_MAX_DEPTH`                           | `32`                    | Tool 参数嵌套深度上限，范围 1–64                    |
| `ARGUMENT_MAX_NODES`                           | `10000`                 | Tool 参数节点数上限，范围 16–100,000                |
| `RATE_LIMIT_MAX`                               | `300`                   | 每个来源 IP 在一个窗口内的最大请求数                |
| `RATE_LIMIT_WINDOW_MS`                         | `60000`                 | 限流窗口，范围 1 秒–1 小时                          |
| `RATE_LIMIT_MAX_KEYS`                          | `10000`                 | 每个副本保存的活动来源键数量上限                    |
| `INTERNAL_ENDPOINTS_ENABLED`                   | `false`                 | 是否启用内部管理接口；启用时必须配置管理令牌        |
| `INTERNAL_ADMIN_TOKEN`                         | unset                   | 内部接口 Bearer 管理令牌，至少 32 个字符            |
| `IDEMPOTENCY_LEASE_MS`                         | `30000`                 | 持久化调用幂等声明租约                              |
| `IDEMPOTENCY_WAIT_TIMEOUT_MS`                  | `10000`                 | 重复 `PENDING`（处理中）调用的等待上限              |
| `IDEMPOTENCY_POLL_MS`                          | `20`                    | 重复调用状态轮询间隔                                |
| `ADAPTER_HEALTH_POLL_MS`                       | `5000`                  | 带身份校验的 Adapter `Describe` 健康探测间隔        |
| `ADAPTER_HEALTH_FAILURE_THRESHOLD`             | `2`                     | Adapter 判为未就绪前允许的连续探测失败次数          |
| `ADAPTER_MANIFEST_POLL_MS`                     | `60000`                 | Adapter Manifest 哈希漂移检查间隔                   |
| `SCHEDULER_POLL_MS`                            | `1000`                  | 定时、截止时间和启动看门狗工作器轮询间隔            |
| `TASK_NOTIFICATION_POLL_INTERVAL_MS`           | `500`                   | Task 通知轮询间隔，范围 100–10,000 ms               |
| `TASK_NOTIFICATION_MAX_SUBSCRIPTIONS`          | `256`                   | 活动订阅全局上限，范围 1–10,000                     |
| `TASK_NOTIFICATION_MAX_SUBSCRIPTIONS_PER_AUTH` | `32`                    | 每授权域活动订阅上限，范围 1–1,000                  |
| `TASK_NOTIFICATION_MAX_TASK_BINDINGS`          | `4096`                  | 订阅 Task 绑定上限，范围 1–100,000                  |
| `TASK_NOTIFICATION_MAX_QUEUE_MESSAGES`         | `64`                    | 每流队列消息上限，范围 1–1,024                      |
| `TASK_NOTIFICATION_MAX_QUEUE_BYTES`            | `1048576`               | 每流队列字节上限，范围 4,096–16,777,216             |
| `TASK_NOTIFICATION_BATCH_SIZE`                 | `256`                   | 通知批量 Task 上限，范围 1–1,000                    |
| `BUSINESS_EVENTS_ENABLED`                      | `false`                 | 是否启用 Business Events Profile V1                 |
| `BUSINESS_EVENTS_REQUIRED_FOR_RUNTIME_READY`   | `false`                 | 是否将全部 Business Event 组件设为 Runtime 就绪依赖 |
| `BUSINESS_EVENTS_RETENTION_MS`                 | `604800000`             | 已定稿业务事件保留期，范围 60,000–7,776,000,000 ms  |
| `BUSINESS_EVENTS_POLL_INTERVAL_MS`             | `500`                   | 当前流轮询间隔，范围 100–10,000 ms                  |
| `BUSINESS_EVENTS_MAX_SUBSCRIPTIONS`            | `256`                   | 活动业务事件订阅全局上限，范围 1–10,000             |
| `BUSINESS_EVENTS_MAX_SUBSCRIPTIONS_PER_AUTH`   | `32`                    | 每授权域活动订阅上限，范围 1–1,000                  |
| `BUSINESS_EVENTS_MAX_QUEUE_MESSAGES`           | `64`                    | 每订阅待发送消息上限，范围 1–1,024                  |
| `BUSINESS_EVENTS_MAX_QUEUE_BYTES`              | `1048576`               | 每订阅待发送字节上限，范围 4,096–16,777,216         |
| `BUSINESS_EVENTS_REPLAY_BATCH_SIZE`            | `256`                   | 每批重放事件上限，范围 1–1,000                      |
| `BUSINESS_EVENTS_MAX_STREAM_DURATION_MS`       | `3600000`               | 单次 SSE 流最长时长，范围 60,000–86,400,000 ms      |
| `BUSINESS_EVENTS_MAX_EVENT_BYTES`              | `65536`                 | 单个来源事件字节上限，范围 1,024–1,048,576          |
| `BUSINESS_EVENTS_MAX_PAYLOAD_DEPTH`            | `16`                    | 来源载荷最大深度，范围 1–64                         |
| `BUSINESS_EVENTS_MAX_PAYLOAD_NODES`            | `4096`                  | 来源载荷最大节点数，范围 16–100,000                 |
| `BUSINESS_EVENTS_MAX_PAYLOAD_STRING_BYTES`     | `16384`                 | 来源载荷单字符串上限，范围 64–1,048,576 bytes       |
| `BUSINESS_EVENT_MAPPING_DEADLINE_MS`           | `60000`                 | 来源事实映射截止时间，范围 1,000–300,000 ms         |
| `BUSINESS_EVENT_MAX_FUTURE_SKEW_MS`            | `300000`                | 来源时间戳最大未来偏移，范围 0–3,600,000 ms         |
| `BUSINESS_EVENT_CLOCK_SKEW_SAFETY_MS`          | `300000`                | 保留期时钟偏移安全量，范围 0–3,600,000 ms           |
| `COMMAND_DISPATCH_CONCURRENCY`                 | `8`                     | 每个副本并发执行的命令声明数                        |
| `SCHEDULER_CONCURRENCY`                        | `8`                     | 每个副本并发执行的定时启动声明数                    |
| `ALLOW_WEAK_LEASE_CONFIGURATION`               | `false`                 | 是否允许弱租约配置；生产环境禁止                    |
| `RECOVERY_POLL_MS`                             | `5000`                  | 非终态任务协调恢复轮询间隔                          |
| `TTL_CLEANER_POLL_MS`                          | `60000`                 | 逻辑过期和清除工作器轮询间隔                        |
| `TTL_PURGE_GRACE_MS`                           | `86400000`              | 从过期到物理清除的宽限期，范围 1 秒–7 天            |
| `OUTBOX_PUBLISHED_RETENTION_MS`                | `86400000`              | 已发布 Outbox 记录保留期，范围 60 秒–90 天          |
| `TTL_CLEANER_BATCH_SIZE`                       | `128`                   | 清理器每阶段、每轮最多声明的行数                    |
| `OUTBOX_SINK`                                  | `internal_noop`         | Outbox 目标：内部空操作或 Webhook                   |
| `OUTBOX_WEBHOOK_URL`                           | unset                   | Webhook 地址；启用时必填，生产环境必须为 HTTPS      |
| `OUTBOX_POLL_MS`                               | `1000`                  | Outbox 发布器轮询间隔                               |
| `OUTBOX_CLEANER_POLL_MS`                       | `60000`                 | 已发布 Outbox（发件箱）记录清理器轮询间隔           |
| `OUTBOX_BATCH_SIZE`                            | `100`                   | 每个发布批次的最大事件数                            |
| `OUTBOX_WEBHOOK_TIMEOUT_MS`                    | `5000`                  | Webhook 请求超时                                    |
| `OTEL_ENABLED`                                 | `false`                 | 是否启用尽力而为的 OTLP 链路、事件和指标导出        |
| `OTEL_EXPORTER_OTLP_ENDPOINT`                  | `http://127.0.0.1:4318` | OTLP/HTTP Collector 基础地址                        |
| `OTEL_EXPORTER_OTLP_TLS_MODE`                  | `disabled`              | Collector TLS 模式；`required` 表示强制双向 TLS     |
| `OTEL_EXPORTER_OTLP_CA_PATH`                   | unset                   | 校验 Collector 的 PEM CA 证书包路径                 |
| `OTEL_EXPORTER_OTLP_CERT_PATH`                 | unset                   | Runtime 访问 Collector 的 PEM 客户端证书路径        |
| `OTEL_EXPORTER_OTLP_KEY_PATH`                  | unset                   | Runtime 访问 Collector 的 PEM 客户端私钥路径        |
| `OTEL_EXPORTER_OTLP_HEADERS_FILE`              | unset                   | 仅供导出器使用的 HTTP 请求头 JSON 文件              |
| `OTEL_EXPORTER_OTLP_TIMEOUT_MS`                | `10000`                 | 单次遥测导出超时，范围 100–60,000 毫秒              |
| `OTEL_SERVICE_INSTANCE_ID`                     | generated UUID          | 可选、稳定且每个副本唯一的遥测实例标识符            |
| `PROVIDER_TELEMETRY_INGRESS_ENABLED`           | `false`                 | 是否启用 Runtime 托管的 Provider 遥测 gRPC 服务     |
| `PROVIDER_TELEMETRY_HOST`                      | `127.0.0.1`             | Provider 遥测入口监听地址                           |
| `PROVIDER_TELEMETRY_PORT`                      | `7002`                  | Provider 遥测入口监听端口                           |
| `PROVIDER_TELEMETRY_TLS_MODE`                  | `disabled`              | 入口 TLS 模式：禁用或强制双向 TLS                   |
| `PROVIDER_TELEMETRY_TLS_CA_PATH`               | unset                   | 校验 Provider 客户端的 CA 证书包路径                |
| `PROVIDER_TELEMETRY_TLS_CERT_PATH`             | unset                   | Runtime 遥测入口服务端证书路径                      |
| `PROVIDER_TELEMETRY_TLS_KEY_PATH`              | unset                   | Runtime 遥测入口服务端私钥路径                      |
| `PROVIDER_TELEMETRY_MAX_BATCH`                 | `100`                   | 单次一元 RPC 可提交的 Provider 事件上限             |
| `PROVIDER_TELEMETRY_MAX_EVENT_BYTES`           | `65536`                 | 单个 Provider 事件编码后的字节上限                  |
| `PROVIDER_TELEMETRY_MAX_DEPTH`                 | `16`                    | Provider 属性/载荷 JSON 最大深度                    |
| `PROVIDER_TELEMETRY_MAX_NODES`                 | `4096`                  | Provider 属性/载荷 JSON 最大节点数                  |
| `PROVIDER_TELEMETRY_RATE_LIMIT`                | `600`                   | 每个副本每分钟接受的 Provider 事件上限              |

`development`（开发认证）仅限本地 Compose。`trusted_headers`（可信请求头认证）要求前置认证代理删除客户端自行提交的 `x-sdar-subject`（主体）和 `x-sdar-tenant`（租户）请求头；`jwt_hs256`（HS256 JWT 认证）是独立生产模式。数据库、JWT 和 mTLS 密钥材料必须通过部署平台轮换，不得放入 ConfigMap 或命令行参数。

生产启动要求非开发认证、`ADAPTER_TLS_MODE=required`（Adapter 必须使用双向 TLS）、完整的三个证书路径，以及 `ALLOW_WEAK_LEASE_CONFIGURATION=false`（禁止弱租约配置）。布尔值仅接受 `true`、`false`、`1` 或 `0`；歧义值会使启动失败。生产环境启用 Provider 遥测入口时必须使用 mTLS，客户端证书 `CN`（通用名称）必须同时等于配置和 Manifest 中的 Provider 标识符。

进程内限流器有容量上限，但按副本独立计数；生产环境应在 Ingress/API Gateway 配置全局来源或租户限流。`IDEMPOTENCY_LEASE_MS`（幂等租约）必须大于 Adapter RPC 超时，同时不超过上游 HTTP 超时预算。声明/完成和 Task 发布使用短数据库事务；已借出的 `PoolClient`（数据库连接池客户端）不得跨越 Adapter RPC，也不得在提交后再次借用。命令和调度声明受并发配置限制，并在 Adapter RPC 执行期间续租。

OTLP Collector（遥测收集器）不是就绪依赖；但启用 `ProviderTelemetryIngress`（Provider 遥测入口）后，入口监听和证书初始化属于就绪检查。生产环境启用 OTLP 时必须使用 HTTPS。只有在 CA、客户端证书和私钥路径齐全时才能设置 `OTEL_EXPORTER_OTLP_TLS_MODE=required`。导出请求头从 `OTEL_EXPORTER_OTLP_HEADERS_FILE` 指向的 JSON 对象文件读取，并且只传给导出器；该文件必须挂载自 Secret，不得放入 ConfigMap 或普通环境变量。密钥文件缺失、格式错误、超限或不完整时，遥测会带脱敏告警地禁用，但业务启动和就绪状态继续。生产环境应为每个副本配置稳定且唯一的 `OTEL_SERVICE_INSTANCE_ID`，并用网络策略限制 Collector 访问。事件、指标、隐私和失败契约见 [Provider 运维遥测](provider-ops-telemetry.md)。

启用 Business Events 时无需新增遥测环境变量：经过验证的 Source Roster 自动成为最多 16 项的
`sourceId` 标签集合；OTLP 初始化早于 Source Worker。OTLP 不可用时 Prometheus 和事务内 Provider
Ops Audit 继续工作。具体指标和失败处置见 [Business Events 遥测运维](business-events-telemetry.md)。
