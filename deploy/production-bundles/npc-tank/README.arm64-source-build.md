# NPC Tank ARM64 源码现场构建独立部署包

本文档只适用于 `sdar-npc-tank-production-arm64-source-build-delivery.zip`。它与同目录
`README.md` 描述的 AMD64 离线镜像包不同：本包不包含 NPC Tank、PMS 或 Web 应用镜像，
也不包含 PostgreSQL 镜像；本项目自行构建的镜像不会发布或推送到任何公共镜像仓库。

交付 ZIP 包含发布 revision 对应的精确源码归档、`pnpm-lock.yaml`、Dockerfile、ARM64
构建计划、基础镜像摘要锁、部署配置和全包校验和。首次执行 `bin/up.sh` 时，目标主机的
Docker 从锁定源码现场构建五个应用镜像，并拉取锁定摘要的 ARM64 PostgreSQL 镜像；
构建结果只存放在该主机的 Docker image store 中。主机无需预装 Git、Node.js 或 pnpm。

## 构建期与运行期网络

首次源码构建要求以下 HTTPS 出网能力：

- Docker Hub，用于拉取 Node.js 和 PostgreSQL 的 ARM64 基础镜像；
- npm 软件包源，用于 Corepack、pnpm 和 lockfile 依赖；
- gRPC 相关依赖下载站点。仅用于仓库审查、且会额外下载 GitHub Release 附件的工具
  不会执行安装脚本；使用组织代理或内部镜像时，应根据构建日志放行等价地址。

这些连接只服务于构建期软件供应链。本项目的 NPC Tank Runtime、PMS、Web 和 Provider
镜像不会上传公共仓库，也不会从公共自研镜像仓库安装。构建完成后的真实业务链路仍是
严格内网明文：Device MCP 使用 `http://.../mcp`，MQTT 使用 `mqtt://`，Runtime 与
Adapter gRPC、Provider telemetry 均禁用 TLS。部署包不生成或挂载 CA、证书、私钥，
也不要求 HTTPS/MQTTS 终结器或安全网关。

Docker Hub 和软件包源通常使用部署主机及 Docker daemon 的标准 HTTPS 信任配置。
若目标环境没有上述 HTTPS 出网，也没有等价的内部代理或镜像源，本源码现场构建包无法
完成首次安装；应改用同目录 `README.md` 描述的离线镜像交付包。这一构建期前提不改变
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 对运行期内网明文传输的明确授权。

## 八个常驻服务

`bin/up.sh` 启动以下八个常驻服务，并运行一次幂等的 `pms-seed`：

| 服务                   | 用途                                  | 主机暴露                     |
| ---------------------- | ------------------------------------- | ---------------------------- |
| `pms-postgres`         | PMS 持久化                            | 不暴露                       |
| `pms-api`              | PMS API                               | 不暴露                       |
| `pms-worker`           | PMS Worker                            | 不暴露                       |
| `pms-web`              | PMS Web、Console V1 与 `/api/v1` 代理 | 默认 `0.0.0.0:8089`，仅内网  |
| `npc-adapter-postgres` | NPC Adapter 状态                      | 不暴露                       |
| `npc-runtime-postgres` | NPC Runtime 状态、任务与事件          | 不暴露                       |
| `npc-tank-adapter`     | NPC Tank Provider Adapter             | 不暴露                       |
| `npc-tank-runtime`     | 匿名 MCP Runtime                      | 默认 `0.0.0.0:19103`，仅内网 |

三个 PostgreSQL 服务和 `pms-api` 只位于 Docker 内部网络，`pms-api` 不发布主机端口。
PMS Web 通过同源 `/api/v1` 匿名开放管理 API 与 SDAR consumer projection，Runtime
`/mcp` 也允许匿名访问。部署方必须通过 VLAN、路由和主机防火墙，把 `8089`、`19103`
及容器网络限制在授权内网内，不得路由到办公公网、互联网或其他不受信网段。
PMS Worker 的无凭据 Catalog 发现由 Compose 中独立的
`PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet` 明确启用，并同时要求
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true`；明文传输许可本身不会改变默认凭据模式。

## 目标主机要求

- 原生 ARM64/AArch64 Linux Docker 主机；构建脚本会拒绝非 Linux ARM64 Docker server；
- Docker Engine、可用的 BuildKit 和 Docker Compose v2；
- Bash、GNU tar、OpenSSL、`sha256sum`、`stat`、`awk` 和常用 POSIX 工具；
- UID 1000，或由 root 初始化并把运行状态和秘密归属设置为 UID/GID 1000；
- 足够容纳源码、BuildKit cache、六个本地镜像、五个持久数据区域和日志的磁盘空间；
- 到真实内网 Device MCP、MQTT 端点的 DNS、路由、防火墙和时钟同步正常；
- 首次构建具备前述 Docker Hub、npm 和 gRPC 依赖站点的 HTTPS 出网能力。

五个应用镜像在目标主机以 `linux/arm64` 构建。PostgreSQL 镜像不包含在 ZIP 中，也不
从源码构建，而是按发布锁定的摘要拉取 ARM64 版本。构建脚本会核对平台、源码 revision、
生产 Provider/profile 标签、非 root 用户和健康检查。任一步骤失败都会在 Compose 启动
前终止，不会回退到 mock、其他 revision 或其他 CPU 架构。

## 首次部署

验证旁路 SHA-256 文件并解压：

```bash
sha256sum --check sdar-npc-tank-production-arm64-source-build-delivery.zip.sha256
unzip sdar-npc-tank-production-arm64-source-build-delivery.zip
cd sdar-npc-tank-production-arm64-source-build
```

初始化配置、状态目录和秘密：

```bash
sudo bash deploy/npc-tank/bin/init.sh
```

`init.sh` 从 `.env.example` 创建 `.env`，随机生成三个 PostgreSQL 数据库凭据及 Runtime
向 PMS 注册所需的实例绑定令牌，并把状态目录和秘密文件限制为 UID 1000 可读。它不会
生成 PMS 管理凭据、Runtime JWT、TLS 证书或私钥，也不会生成、复制或猜测真实 NPC
端点凭据。重复执行会保留已有秘密，不会自动轮换。

编辑 `deploy/npc-tank/.env`，至少替换真实内网端点：

```dotenv
ALLOW_INSECURE_INTERNAL_TRANSPORT=true
NPC_TANK_DEVICE_MCP_URL=http://npc-device-mcp.intranet.local/mcp
NPC_TANK_MQTT_URL=mqtt://mqtt.intranet.local:1883
NPC_TANK_RUNTIME_ADVERTISED_URL=http://192.168.1.7:19103
```

### 可选：启用 Runtime OTLP 导出

OTLP 导出默认关闭。需要把 Runtime 的 traces、logs 和 metrics 推送到内网 OpenTelemetry
Collector 时，在 `deploy/npc-tank/.env` 中设置：

```dotenv
NPC_TANK_OTEL_ENABLED=true
NPC_TANK_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.intranet.local:4318
NPC_TANK_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000
```

Endpoint 是 OTLP/HTTP 基础地址，通常使用端口 `4318`，不能包含 `/v1/traces`、
`/v1/logs` 或 `/v1/metrics`；Runtime 会自动追加对应路径。服务实例 ID 固定为 PMS
direct-container 实例 `production-npc-tank-direct-1`，不由现场配置。若 Collector 运行在
部署主机上，应填写 Runtime 容器可达的主机内网地址，不能填写 `127.0.0.1` 或
`localhost`。严格内网运行策略只允许明文 HTTP，不配置 OTLP TLS CA/证书/私钥，也不
发送认证 headers；Collector 端口必须限制在隔离内网。超时值单位为毫秒，必须在
`100` 到 `60000` 之间。

保留旧 `.env` 且不补这些键时仍保持默认关闭。修改后重新执行
`bash deploy/npc-tank/bin/up.sh`，Compose 会重建配置变化的 `npc-tank-runtime` 并保留
其他未变化服务；无需重新生成 ZIP，也无需重新构建应用镜像。

从旧交付升级且保留既有 `.env` 时，`init.sh` 不会覆盖该文件；必须手动补入
`NPC_TANK_RUNTIME_ADVERTISED_URL`。首次 seed 后 direct-container 的 control/advertised
端点属于部署身份的一部分，不能只编辑 `.env` 改址。当前包不提供自动改址流程；如需
变更，必须先备份，并在维护窗口使用单独评审的部署重建或数据迁移程序。

从带 PMS 管理令牌和 Runtime JWT 的旧包升级时，使用本版本 ZIP 中的源码重新构建应用
镜像，保留 `.env`、`state/` 和数据库卷后再运行 `init.sh`、`up.sh`。旧凭据文件可以
暂时留存用于回滚，但新 Compose 不再挂载、读取或校验它们。

不要把 revision、平台、基础镜像、摘要、构建目标或可部署状态等发布身份键写入用户
`.env`；这些值只能来自发布流程生成的只读构建锁文件。

启动：

```bash
bash deploy/npc-tank/bin/up.sh
```

`up.sh` 会在修改 Compose 状态前校验全包和精确源码归档，检查原生 ARM64 Docker 与
BuildKit，拉取摘要锁定的基础镜像，在本机构建并核对五个生产应用镜像。全部通过后才会
启动八个常驻服务、执行幂等 PMS seed，并运行真实链路只读 smoke。整个过程不会向公共
或私有应用镜像仓库执行 push。

## 状态、真实只读 smoke 和停止

```bash
bash deploy/npc-tank/bin/status.sh
bash deploy/npc-tank/bin/smoke.sh
bash deploy/npc-tank/bin/down.sh
```

`smoke.sh` 检查八个容器、三个 PostgreSQL 实例、PMS Web 匿名 `/api/v1` 管理代理、
匿名 SDAR projection、ACTIVE 的 `direct_container` RuntimeDeployment 和新鲜
registration/heartbeat，并从 PMS Registry 发布的 advertised endpoint 匿名验证 Runtime
和真实 Device MCP/MQTT 连接，只调用以下四个读取工具：

PMS Web smoke 会先从容器网络执行，再用现场构建且已经校验的本地 PMS Web 镜像运行
`docker run --network host`（仅使用前序已核验存在的本地镜像），请求 `.env` 中实际发布的地址和端口；
`0.0.0.0`/`::` 会分别规范为 `127.0.0.1`/`::1`。宿主无需 Node.js 或 curl，验证过程也不会拉取镜像。

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

它不会调用移动、导航、侦察、跟踪、火控、效应器或其他变更操作；真实端点不可达时会
失败，不会用 mock 数据给出成功结果。当前 NPC smoke 不单独断言 MQTT telemetry 的
采样新鲜度，因此通过结果只代表连接和四个只读调用通过，不能扩展声称新鲜数据已验证。

SDAR 使用
`http://<PMS_WEB_HOST>:<PMS_WEB_PORT>/api/v1/registry/production/consumers/sdar/v1/sources/npc-tank-smpp/latest`
匿名读取 projection，再匿名调用返回的 `serverEndpoint`；无需也不应直连 `pms-api:8090`。
SDAR 客户端必须支持 credential mode `none`（不发送 `Authorization`）；仍强制
`credentialRef`/Bearer 的旧版客户端需先升级，不能配置伪造 token。

`down.sh` 只停止容器，保留 PostgreSQL 数据卷、Worker 状态、合约报告、`.env` 和秘密。
除非已经确认要永久删除数据库，否则不要使用 `docker compose down --volumes`。

## 秘密、备份与资格边界

秘密和状态目录必须保持初始化脚本设置的 UID 1000、目录 `0700`、文件 `0600` 权限。
备份至少覆盖三个数据库的一致性备份、`deploy/npc-tank/.env`、配置的 `state/` 目录和
Docker 持久卷，并按组织的密钥托管策略加密保存。数据库密码或 Runtime registration
令牌轮换需要协调多个内部消费者，应在维护窗口按整体迁移方案执行。

本包提供从精确源码在原生 ARM64 主机生成部署镜像的路径，但不把本机构建结果自动认定
为生产认证。NPC Tank Provider Package 的 real-resource 状态仍为 `pending`。Runtime
容器由 Compose 直接启动；PMS 以 `runtimeAuthority=direct_container` 接纳，Runtime
自行注册和心跳，Worker 跳过 PM2 并以 `registryAuthority=pms_worker` 发布 Catalog/
Registry。production qualification 仍为 `NOT_CLAIMED`。

只有目标主机上的源码构建、八服务健康检查、PMS seed 和真实只读 smoke 全部通过后，
才能记录该次现场部署已经验证；该结果不会把全局资格状态提升为 `qualified`，也不会
授权执行移动、火控或其他真实设备副作用测试。
