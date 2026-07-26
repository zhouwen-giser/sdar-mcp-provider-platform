# SDAR MCP Provider Platform

SDAR MCP Provider Platform is the Provider-side control plane and standard
runtime platform being built from the delivered **SDAR MCP Tasks Provider
Runtime** repository. It keeps the existing independently deployable,
language-neutral Runtime for the SEP-2663 task lifecycle and the
`io.sdar/taskExecution` Provider Profile, while adding Provider management,
configuration, deployment governance, Catalog/Registry publication, and
Provider Package capabilities in the same monorepo.

The repository is unified; authority and process boundaries are not. PMS owns
desired state and control-plane data, Runtime remains the Task Authority and
MCP data plane, and Provider Adapters retain device facts and side effects.
See [Platform scope and compatibility](docs/architecture/platform-scope.md)
before changing those boundaries.

## Platform upgrade status

The current platform work starts from the immutable offline Runtime/Provider
delivery recorded in
[`SOURCE_LOCK.json`](docs/baseline/SOURCE_LOCK.json). Existing workspace
package names, `@sdar/*` package identities, Runtime entry points, and root
scripts remain compatible during the upgrade; new platform packages are added
incrementally instead of renaming the delivered Runtime tree in bulk.

Goal 1 establishes the platform foundation: Migration ownership, Provider
Packages, shared configuration contracts, PMS control-plane foundations, and
the Runtime configuration client. Automated PM2 Runtime deployment,
Catalog/Registry governance, and the Console belong to Goal 2 and are not
claimed by the current foundation.

## Delivered Runtime baseline

The baseline Runtime is implemented in strict TypeScript and delegates resource
facts and side effects to versioned gRPC/Protobuf Adapters.

The current development target is `v2.0.0-rc.1`, migrating the primary `/mcp` endpoint to the
frozen SDAR MCP Tasks Unified Protocol Profile V1.0 while retaining the `1.1.0` Provider Ops Wire
Schema. Its live plan is
[`frozen-protocol-v1-exec-plan.md`](docs/implementation/frozen-protocol-v1-exec-plan.md).
Published `v1.0.0-rc.2` and `v1.0.0-rc.3` migrations, reports, tags, and release history remain
immutable.

## 中文接口文档导航

面向外部系统的接口以中文说明为主，并保留协议中的英文标识符：

- [Runtime API 参考](docs/protocol/api-reference.md)：说明 HTTP 健康/管理接口、MCP JSON-RPC 方法、`tasks/observations`（任务观测分页）和 Adapter gRPC 方法，包含输入输出样例。
- [Provider 遥测入口](docs/protocol/provider-telemetry-ingress.md)：说明 `ProviderTelemetryIngress`（Provider 遥测入口）及 `EmitProviderEvents`（批量提交事件）的字段、mTLS 身份规则、错误码和 TypeScript/Python 客户端样例。
- [Provider 运维遥测](docs/operations/provider-ops-telemetry.md)：说明 `ProviderOpsEnvelope`（Provider 运维事件信封）、外部 Collector 输出、指标、隐私和失败语义。
- [Runtime 配置参考](docs/operations/configuration.md)：逐项解释环境变量、默认值和生产环境失败关闭要求。
- [Adapter 快速开始](docs/adapter/quick-start.md)：说明 Provider/Adapter 对接方向和双语言示例客户端。

## Runtime quick start

Prerequisites: Node.js 22, Corepack/pnpm 11, and Docker with Compose access.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm test:unit
pnpm test:contract
docker compose up --build --wait
curl --fail http://127.0.0.1:8080/health/ready
```

The default stack exposes Runtime HTTP on `:8080`, PostgreSQL on `:5432`, and an internal TypeScript Adapter on `:7001`. A Python Adapter image can be built with:

```bash
docker compose --profile python-adapter build adapter-python
```

Runtime startup applies migrations and runs durable scheduling/recovery before
readiness. The reference Adapter state and PostgreSQL data use named volumes.
For a release gate with PostgreSQL and Docker available, run:

```bash
TEST_DATABASE_URL=postgresql://sdar:sdar@127.0.0.1:5432/sdar_runtime_test pnpm verify:v2
```

Configuration and security are documented in
[`configuration.md`](docs/operations/configuration.md) and
[`security-recovery.md`](docs/operations/security-recovery.md); deployment and
incident procedures are in the [`runbook`](docs/operations/runbook.md). OTLP signal contracts,
privacy rules and failure behavior are in
[`provider-ops-telemetry.md`](docs/operations/provider-ops-telemetry.md).
The signal architecture and Provider-facing gRPC contract are documented in
[`observability.md`](docs/architecture/observability.md) and
[`provider-telemetry-ingress.md`](docs/protocol/provider-telemetry-ingress.md).

Adapter authors should begin with the
[`quick start`](docs/adapter/quick-start.md) and dual-language expanded Adapter
protocol workflow in
[`adapter-testkit.md`](docs/conformance/adapter-testkit.md). API/RPC and state
semantics are summarized in [`api-reference.md`](docs/protocol/api-reference.md)
and [`state-reason-mapping.md`](docs/implementation/state-reason-mapping.md).
The machine reports mark Runtime Profile coverage `partial` and real-resource
safety `not_claimed`; a Mock Adapter result is not production qualification.
Both mock Adapters include Provider telemetry clients and examples for resource state/metric/health,
Task-bound execution progress, and replaying the same Provider event id after an uncertain call.
This Provider-to-Runtime service requires no Provider-side OpenTelemetry SDK.

The standalone [Home Assistant Climate Provider](docs/providers/home-assistant-climate-provider.md)
adds allowlisted `climate.*` state, power, HVAC-mode, and target-temperature operations through
Home Assistant REST and WebSocket APIs.

The standalone [UGV Provider](docs/providers/ugv-provider.md) adds one simulation resource,
`vehicle:ugv1`, with exact-topic MQTT ingress, allowlisted Device MCP control, durable PostgreSQL
execution/replay state, confirmed long-running operations, local-only fire-control semantics and
restart reconciliation. Its mock deployment is started with:

```bash
docker compose --profile ugv-provider up --build --wait
curl --fail http://127.0.0.1:19100/health/ready
```

See the [UGV runbook](docs/operations/ugv-provider-runbook.md) for production TLS, contract capture,
failure isolation, recovery and verification procedures.

Production Kubernetes JSON manifests are under [`deploy/kubernetes`](deploy/kubernetes),
with migration/upgrade instructions in [`docs/database/upgrade.md`](docs/database/upgrade.md).
Root commands in `package.json` expose every release gate; `pnpm verify:v2` includes the frozen
contract/hash checks, the numbered 74-case report, and the existing
formatting, lint, types, build/Proto drift, audit/SBOM, deployment/container,
unit/contract/integration/recovery/security/E2E/conformance, the six rc.1 red-regression guards,
and the rc.3 capacity checks. CI additionally runs Buf lint/breaking against the immutable rc.1
tag and builds the Runtime plus both Adapter images with Compose.
