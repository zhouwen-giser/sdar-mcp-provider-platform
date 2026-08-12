# UGV ARM64 源码现场构建独立部署包

本文档只适用于 `sdar-ugv-production-arm64-source-build-delivery.zip`。它与同目录
`README.md` 描述的 AMD64 离线镜像包是两种不同交付形式：本包不包含 UGV 应用镜像、
PMS 应用镜像或 PostgreSQL 镜像，也不会把本项目自行构建的镜像发布或推送到任何公共
镜像仓库。

交付 ZIP 携带发布版本对应的精确源码归档、`pnpm-lock.yaml`、Dockerfile、ARM64 构建
计划、基础镜像摘要锁、部署配置和全包校验和。首次执行 `bin/up.sh` 时，目标主机上的
Docker 会拉取锁定的 ARM64 基础镜像并在本机从源码构建五个应用镜像；构建结果只保留
在该主机的 Docker image store 中。部署主机不需要预装 Git、Node.js 或 pnpm。

## 网络边界

源码构建阶段与运行阶段采用不同的网络边界：

- 首次构建必须能通过 HTTPS 访问 Docker Hub，以拉取 Node.js 和 PostgreSQL 的 ARM64
  基础镜像；
- Docker 构建还必须能通过 HTTPS 访问 npm 软件包源和 gRPC 相关依赖下载站点。仅用于
  仓库审查、且会额外下载 GitHub Release 附件的工具不会执行安装脚本；
- 本项目的 UGV Runtime、PMS、Web 和 Provider 镜像只在目标主机构建，不上传公共仓库；
- 上述 HTTPS 只用于构建期软件供应链访问，不改变运行期的严格内网明文策略。

运行后，Device MCP 使用内网 `http://.../mcp`，MQTT 使用 `mqtt://`（或经审查的
`ws://`），Runtime 与 Adapter RPC 以及 Provider telemetry 均不启用 TLS。部署包不
生成或挂载应用侧 CA、证书和私钥，也不要求 HTTPS/MQTTS 终结器或安全网关。
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 是生产进程使用该策略的显式许可。

Docker Hub 和软件包源通常依赖部署主机及 Docker daemon 的标准 HTTPS 信任配置。
如果目标环境完全不能进行上述 HTTPS 出网，也没有等价内部代理或镜像源，则不能使用
本源码现场构建包；应改用同目录 `README.md` 所描述的离线镜像交付包。

## 服务清单

部署包含八个常驻服务，并在启动时运行一次幂等的 `pms-seed`：

| 服务                   | 用途                                  | 主机暴露                     |
| ---------------------- | ------------------------------------- | ---------------------------- |
| `pms-postgres`         | PMS 持久化                            | 不暴露                       |
| `pms-api`              | PMS API                               | 不暴露                       |
| `pms-worker`           | PMS Worker                            | 不暴露                       |
| `pms-web`              | PMS Web、Console V1 与 `/api/v1` 代理 | 默认 `0.0.0.0:8088`，仅内网  |
| `ugv-adapter-postgres` | UGV Adapter 状态                      | 不暴露                       |
| `ugv-runtime-postgres` | UGV Runtime 状态、任务与事件          | 不暴露                       |
| `ugv-adapter`          | UGV Provider Adapter                  | 不暴露                       |
| `ugv-runtime`          | 匿名 MCP Runtime                      | 默认 `0.0.0.0:19100`，仅内网 |

三个 PostgreSQL 服务和 `pms-api` 位于 Docker 内部网络，`pms-api` 不发布主机端口。
PMS Web 通过同源 `/api/v1` 代理匿名开放管理 API 与 SDAR consumer projection，Runtime
`/mcp` 也允许匿名访问。必须依靠 VLAN、路由、主机防火墙和访问控制，把 `8088`、
`19100` 及所有容器网络端口限制在授权内网内。
PMS Worker 仅因 Compose 另行设置
`PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet` 才无凭据发现 Runtime；
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 单独存在时仍按默认 `file_credentials` 失败关闭。

## 目标主机要求

- 原生 ARM64/AArch64 Linux Docker 主机；构建脚本会拒绝非 Linux ARM64 Docker server；
- Docker Engine、可用的 BuildKit 和 Docker Compose v2；
- Bash、GNU tar、OpenSSL、`sha256sum`、`stat`、`awk` 和常用 POSIX 工具；
- UID 1000，或可由 root 初始化后把状态和秘密文件归属设置为 UID/GID 1000；
- 足够容纳源码构建上下文、BuildKit cache、六个本地镜像、数据库卷和日志的磁盘空间；
- 到真实内网 Device MCP、MQTT 端点的 DNS、路由、防火墙和时钟同步正常；
- 首次构建具备前述 Docker Hub、npm 和 gRPC 依赖站点的 HTTPS 出网能力。

五个应用镜像以 `linux/arm64` 为目标在本机生成。PostgreSQL 镜像不参与源码构建，
而是由 Docker 按发布锁定的摘要拉取 ARM64 版本。构建脚本会检查操作系统、架构、源码
revision、生产 Provider/profile 标签、非 root 用户和健康检查；任何检查失败都会在
Compose 启动前终止，不会回退到 mock 镜像或其他 CPU 架构。

## 首次部署

先验证交付 ZIP 的旁路校验文件并解压：

```bash
sha256sum --check sdar-ugv-production-arm64-source-build-delivery.zip.sha256
unzip sdar-ugv-production-arm64-source-build-delivery.zip
cd sdar-ugv-production-arm64-source-build
```

初始化配置和秘密：

```bash
sudo bash deploy/ugv/bin/init.sh
```

`init.sh` 从 `.env.example` 创建权限受限的 `.env`，创建状态目录，并随机生成三个
PostgreSQL 数据库凭据及 Runtime 向 PMS 注册所需的实例绑定令牌。它不会生成 PMS
管理凭据、Runtime JWT、TLS 证书，也不会生成、复制或猜测真实 UGV 端点的凭据。
重复执行会保留已有随机秘密，不会自动轮换。

编辑 `deploy/ugv/.env`，至少设置真实内网端点和明确的 wire mode：

```dotenv
ALLOW_INSECURE_INTERNAL_TRANSPORT=true
UGV_SIM_DEVICE_MCP_URL=http://device-mcp.intranet.local/mcp
UGV_SIM_MQTT_URL=mqtt://mqtt.intranet.local:1883
UGV_MQTT_WIRE_MODE=ros_bridge_json
UGV_RUNTIME_ADVERTISED_URL=http://192.168.1.7:19100
```

### 可选：启用 Runtime OTLP 导出

OTLP 导出默认关闭。需要把 Runtime 的 traces、logs 和 metrics 推送到内网 OpenTelemetry
Collector 时，在 `deploy/ugv/.env` 中设置：

```dotenv
UGV_OTEL_ENABLED=true
UGV_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.intranet.local:4318
UGV_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000
```

Endpoint 是 OTLP/HTTP 基础地址，通常使用端口 `4318`，不能包含 `/v1/traces`、
`/v1/logs` 或 `/v1/metrics`；Runtime 会自动追加对应路径。服务实例 ID 固定为 PMS
direct-container 实例 `production-ugv-direct-1`，不由现场配置。若 Collector 运行在部署
主机上，应填写 Runtime 容器可达的主机内网地址，不能填写 `127.0.0.1` 或 `localhost`。
严格内网运行策略只允许明文 HTTP，不配置 OTLP TLS CA/证书/私钥，也不发送认证
headers；Collector 端口必须限制在隔离内网。超时值单位为毫秒，必须在 `100` 到
`60000` 之间。

保留旧 `.env` 且不补这些键时仍保持默认关闭。修改后重新执行
`bash deploy/ugv/bin/up.sh`，Compose 会重建配置变化的 `ugv-runtime` 并保留其他未变化
服务；无需重新生成 ZIP，也无需重新构建应用镜像。

从旧交付升级且保留既有 `.env` 时，`init.sh` 不会覆盖该文件；必须手动补入
`UGV_RUNTIME_ADVERTISED_URL`。首次 seed 后 direct-container 的 control/advertised
端点属于部署身份的一部分，不能只编辑 `.env` 改址。当前包不提供自动改址流程；如需
变更，必须先备份，并在维护窗口使用单独评审的部署重建或数据迁移程序。

从带 PMS 管理令牌和 Runtime JWT 的旧包升级时，使用本版本 ZIP 中的源码重新构建应用
镜像，保留 `.env`、`runtime/` 和数据库卷后再运行 `init.sh`、`up.sh`。旧凭据文件可以
暂时留存用于回滚，但新 Compose 不再挂载、读取或校验它们。

不要在 `.env` 中加入 revision、平台、基础镜像、摘要、构建目标或可部署状态等发布
身份键；它们只能来自交付流程生成的只读构建锁文件。

启动：

```bash
bash deploy/ugv/bin/up.sh
```

`up.sh` 会在修改 Compose 状态前依次完成：交付包和源码归档校验、ARM64/BuildKit
检查、摘要锁定的基础镜像拉取、五个生产应用镜像的本机源码构建和元数据核验。随后它
启动八个常驻服务、执行幂等 PMS seed，并运行真实链路只读 smoke。构建过程中不会向
公共或私有应用镜像仓库执行 push。

## 状态、只读验证和停止

```bash
bash deploy/ugv/bin/status.sh
bash deploy/ugv/bin/smoke.sh
bash deploy/ugv/bin/down.sh
```

`smoke.sh` 检查八个容器、三个 PostgreSQL 实例、PMS Web 匿名 `/api/v1` 管理代理、
匿名 SDAR projection、ACTIVE 的 `direct_container` RuntimeDeployment 和新鲜
registration/heartbeat，并从 PMS Registry 发布的 advertised endpoint 匿名验证 Runtime、
真实 Device MCP/MQTT 连接和数据新鲜度，只调用以下读取工具：

PMS Web 检查会先从容器网络执行，再用现场构建且已经校验的本地 PMS Web 镜像运行
`docker run --network host`（仅使用前序已核验存在的本地镜像），请求 `.env` 中实际发布的地址和端口；
`0.0.0.0`/`::` 会分别规范为 `127.0.0.1`/`::1`。宿主无需 Node.js 或 curl，验证过程也不会拉取镜像。

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

它不会调用导航、侦察、跟踪、激光、效应器或其他变更型操作。真实端点不可达、MQTT
尚未收到数据或状态超过 `UGV_SMOKE_MAX_STATE_AGE_MS` 时，smoke 会失败，而不是使用
模拟数据给出成功结果。

SDAR 使用
`http://<PMS_WEB_HOST>:<PMS_WEB_PORT>/api/v1/registry/production/consumers/sdar/v1/sources/ugv-smpp/latest`
匿名读取 projection，再匿名调用返回的 `serverEndpoint`；无需也不应直连 `pms-api:8090`。
SDAR 客户端必须支持 credential mode `none`（不发送 `Authorization`）；仍强制
`credentialRef`/Bearer 的旧版客户端需先升级，不能配置伪造 token。

`down.sh` 只停止容器，保留三个具名数据库卷、Worker 状态、合同捕获文件、`.env` 和
秘密。不要使用 `docker compose down --volumes`，除非已经确认要永久删除数据库。

## 数据、秘密与资格边界

秘密和状态文件必须保持部署脚本设置的 UID 1000、目录 `0700`、文件 `0600` 权限。
备份至少应覆盖数据库一致性备份、`deploy/ugv/.env`、`deploy/ugv/secrets/`、Worker
状态和 UGV 合同报告，并按组织策略加密保存。数据库密码或 Runtime registration 令牌
轮换涉及多个内部消费者，应在维护窗口按整体迁移方案执行。

本包仅提供从精确源码在原生 ARM64 主机生成部署镜像的可重复路径，不声称构建产物已经
完成目标现场的生产认证。UGV Provider Package 的 real-resource 状态仍为 `pending`；
当前异构 MQTT bridge 的 envelope、topic 和 QoS 差异仍属于部分资格。Runtime 容器由
Compose 直接启动；PMS 以 `runtimeAuthority=direct_container` 接纳，Runtime 自行注册和
心跳，Worker 跳过 PM2 并以 `registryAuthority=pms_worker` 发布 Catalog/Registry。
production qualification 仍为 `NOT_CLAIMED`。

只有目标主机上的源码构建、八服务健康检查、PMS seed 以及真实只读 smoke 全部通过后，
才能把该次现场部署记录为已验证；这不会把全局资格状态自动提升为 `qualified`，也不会
授权执行任何真实设备副作用测试。
