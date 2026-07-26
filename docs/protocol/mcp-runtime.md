# MCP Runtime Boundary

The Streamable HTTP endpoint is `POST /mcp`. It uses the official TypeScript MCP SDK while every SDK import remains inside `packages/mcp-protocol`.

The endpoint is explicitly stateless under SDK 1.29.0: every POST creates an independent Server
and transport, no MCP session id or resumable event store is issued, and GET/DELETE session
lifecycle plus Task status notifications are not advertised. Durable Task ids, PostgreSQL state
and `tasks/get`/`tasks/result` polling provide continuity across requests and replicas.

At startup Runtime calls Adapter DescribeProvider, validates and hashes the Manifest, persists immutable operation snapshots, and builds one Tool per operation. Resource instances remain Tool arguments and never expand the catalog.

Initialization declares Tools and both task extensions. Profile booleans are derived from Runtime support and loaded operation capabilities. Every Tool publishes `_meta["io.sdar/taskExecution"]` with execution mode and supported scheduling, elapsed-time, observation, input, cancellation and idempotency features.

Synchronous StartOperation completes as an ordinary Tool result. `task_required` always publishes a durable SEP-2663 Task after Adapter acceptance. `task_capable` returns an ordinary result when its initial Snapshot is terminal and otherwise follows the same durable publication path. Rejection becomes `CallToolResult.isError=true` with `admission_rejected` and never creates a Task.

Operation Registry retains both compiled validators. Raw Adapter output is checked before every
synchronous, inline, asynchronous-success or partial publication and is subject to byte, depth
and node limits. Schema-invalid output is converted to a stable Adapter-contract technical
failure; Runtime never republishes it as success. Business/partial results use the standardized
`isError=true` envelope, while successful `structuredContent` remains the Adapter output defined
by the operation schema.

The MCP boundary maps the domain error hierarchy once. Invalid requests, hidden Tasks, expiry
and capability failures use JSON-RPC Invalid Params with stable reason data. Pre-publication
technical failures use JSON-RPC Internal Error; post-publication technical failures are stored as
Task `failed/error`. The locked SDK's top-level Task fields are `ttl` and `pollInterval`; Profile
aliases exist only under `_meta["io.sdar/taskExecution"]` as `ttlMs` and `pollIntervalMs`.

`tasks/get` binds taskId to the trusted authorization-context hash, execution mode, and simulation identity. Nonterminal reads perform the safe Adapter `GetExecution` RPC, apply only a greater observation revision, and atomically update task/outbox/observation data. Once a terminal state is stored, later Adapter observations cannot reverse it. Business failure and partial completion remain MCP `completed` with structured outcome data; only technical failure uses MCP `failed`.

## 观测分页接口 `tasks/observations`

`tasks/observations`（任务观测记录分页查询方法）向外部系统提供不可变的任务状态历史。输入包括 `taskId`（任务标识符）、可选的 `cursor`（分页游标）和 `limit`（单页条数，默认 `100`，范围 `1–100`）。输出中的 `observations`（观测记录数组）按 `revision`（观测修订号）从新到旧排列；`_meta.observationCursor`（下一页游标）可直接作为下一次请求的 `cursor`，`_meta.hasMore`（是否仍有下一页）用于决定是否继续读取。

该方法沿用与 `tasks/get` 相同的授权上下文绑定，不能跨租户读取任务。完整字段、JSON-RPC 输入/输出样例和错误响应见 [Runtime API 参考](api-reference.md#任务观测分页接口-tasksobservations)。

`io.sdar/taskExecution/checkAvailability` accepts 1–128 independent checks. Runtime validates operation support and known arguments, then performs one Adapter batch RPC with trusted execution context. Results must preserve request identity, use one of four Profile states, keep `validUntil` at or after `checkedAt`, and provide the required restricted-risk/effect fields and ordered valid windows. A transport failure yields explicit per-check `unknown`; it never claims `available` and never reserves a resource.

When `tools/call.params._meta["io.sdar/taskExecution"].idempotencyKey` is present, Runtime binds the canonical deep argument hash to authorization, operation, mode, and simulation. Duplicate synchronous calls return the stored Tool result; duplicate task calls return the original immediately queryable taskId. A different argument hash is a conflict. Pending calls reuse the stable taskId and Reconcile before a safe retry.

The same Profile metadata carries `timing`. Runtime validates zoned RFC 3339 scheduled time, nonnegative integer start tolerance, positive-or-null max elapsed, and Manifest capability agreement. Scheduled calls publish a durable Task immediately and do not call StartOperation before `scheduledAt`. Database workers atomically claim due rows; missing the latest-start boundary completes with `start_window_missed` without Adapter side effects. Deadline workers persist `STOPPING` before RequestCancel and wait for a later Adapter Snapshot before publishing the `deadline_reached` completed result. `maxElapsedMs=null` stores no deadline.

Official `tasks/cancel` is Ack-only: Runtime first journals a CANCEL command and publishes `working/stopping`, then sends RequestCancel. Only a later, greater Adapter Snapshot publishes `cancelled`; a concurrent natural success remains `completed`. Deadline and user cancellation share this journal, preserving the first stop reason.

Profile `tasks/update` validates only open stable input keys against their stored Draft 2020-12 schemas, journals an UPDATE command, and returns the current Task snapshot with a command receipt. The receipt indicates Runtime durable acceptance only and does not prove Adapter execution.
Repeated equal answers and repeated cancellation are side-effect free, while conflicting or unknown inputs fail before gRPC.

When declared by the operation, Profile pause/resume methods journal conditional Adapter commands and expose their substates through ordinary `working` Tasks. Every greater Adapter revision is inserted once, in ascending order, in the same transaction as current Task state and an outbox event. Delivery attempts are independent of `tasks/get`, so notification failure cannot corrupt query correctness.

Runtime startup does not become ready until migrations, Manifest validation, Adapter DescribeProvider, immutable snapshot persistence, and the first recovery scan complete. Recovery reconciles uncertain Admission states and nonterminal Tasks. The Durable Command Dispatcher exclusively claims and executes persisted commands, including commands whose previous claim lease expired. The same scan runs periodically as an event-stream/polling fallback. A transient Adapter or database fault retains confirmed rows and makes readiness reflect dependency health; it never invents success.

Authentication is pluggable: explicit development identity, trusted proxy headers, or signed HS256 JWT with expiry/issuer/audience checks. Authorization context, execution mode, and simulation identity are part of every Task query/control predicate and Adapter execution context. Production Adapter transport supports mutual TLS from configured CA/client certificate/private key files; plaintext is an explicit development mode. HTTP body size, JSON byte/depth/node complexity, availability batch, key, TTL, timing, and schema bounds are enforced before side effects. Adapter endpoints are fixed startup configuration and cannot be selected by Tool arguments.

The low-level official SDK Server is intentional because Adapter input/output documents are validated JSON Schema Draft 2020-12, whereas the high-level registration API accepts application-owned Zod schemas. SDK types do not enter domain, registry or persistence packages.

The availability batch bound is 1-128 checks. The rc.2 publication path commits intent, Task,
first Runtime Observation and Outbox event before returning a Task. Post-commit visibility uses
the same checked-out PostgreSQL client and releases it before returning; a one-connection pool
therefore cannot deadlock or span an Adapter RPC.
