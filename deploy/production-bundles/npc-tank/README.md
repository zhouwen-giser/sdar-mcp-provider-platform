# NPC Tank 生产环境独立部署包

本目录用于严格隔离内网中的 NPC Tank 独立部署。它以 `RUNTIME_ENV=production`
运行完整的 PMS、Runtime 和 NPC Provider，但按部署方明确选择使用明文内部传输；无需
CA、受信 TLS 证书、HTTPS/MQTTS 终结器或安全网关。

## 服务清单

`bin/up.sh` 启动八个常驻服务：

- PMS PostgreSQL、PMS API、PMS Worker、PMS Web
- NPC Adapter PostgreSQL、Runtime PostgreSQL
- NPC Tank Provider Adapter、NPC Tank Runtime

此外，`pms-seed` 是一次性的初始化服务。它从 scoped PMS Worker 镜像内的权威
Provider Package 创建或核对 NPC Provider Type、Provider、Resource、Binding，以及正式的
`direct_container` RuntimeDeployment 和预期实例。

## 内网传输策略

此包固定设置 `ALLOW_INSECURE_INTERNAL_TRANSPORT=true`，同时保持生产模式。启动前的
Compose 策略校验会确认：

| 链路                        | 协议/模式                                          |
| --------------------------- | -------------------------------------------------- |
| Device MCP → Adapter        | `http://.../mcp`，TLS disabled                     |
| MQTT → Adapter              | `mqtt://...`，TLS disabled，默认匿名连接           |
| Runtime → Adapter           | 内部 gRPC，TLS disabled                            |
| Adapter → Runtime telemetry | 内部 gRPC，TLS disabled                            |
| PMS Web                     | 内网 HTTP，匿名代理 `/api/v1`，默认 `0.0.0.0:8089` |
| NPC Runtime                 | 匿名 MCP，默认发布在 `0.0.0.0:19103`               |

初始化脚本不会生成证书、私钥、PMS 管理凭据或 Runtime JWT，Compose 也不会挂载或
校验这些材料。三个 PostgreSQL 数据库凭据及 Runtime 向 PMS 注册所需的实例绑定令牌
仍由 `bin/init.sh` 随机生成并以 `0600` 文件保存。Device MCP 默认不附加认证 headers，
MQTT 默认匿名连接。

PMS Worker 的 Catalog 应用鉴权不是从明文传输许可推导：本包还显式固定
`PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet`。只有该模式和
`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 同时存在，Worker 才会无 `Authorization` 发现
Compose Runtime；删除前者会恢复默认的 `file_credentials` 失败关闭行为。

该选择把网络边界责任交给部署环境：部署主机和 Device MCP/MQTT 必须位于受控 VLAN
或物理隔离网段，防火墙只能允许所需的内网来源。`pms-api` 不发布主机端口；PMS Web
通过同源 `/api/v1` 匿名开放管理 API 与 SDAR consumer projection，Runtime `/mcp` 也
允许匿名访问。不得把 `8089`、`19103` 或任何容器网络端口路由到办公公网、互联网或
其他不受信网段。

## 主机要求

- 与交付镜像 CPU 架构匹配的 Linux 主机；`init.sh` 可由 UID `1000` 或 root 执行，容器以 UID `1000` 运行
- Docker Engine 与 Docker Compose v2
- Bash、OpenSSL（仅用于随机密钥）、`sha256sum`、`stat`、`awk`
- 足够容纳离线镜像、五个持久卷和运行日志的磁盘空间

镜像已包含在交付包中，部署过程不需要访问镜像仓库或软件包仓库。

## 首次部署

在解压后的交付包根目录执行：

```bash
cp deploy/npc-tank/.env.example deploy/npc-tank/.env
chmod 0600 deploy/npc-tank/.env
```

编辑 `.env`，至少替换以下三个占位地址：

```dotenv
NPC_TANK_DEVICE_MCP_URL=http://REAL_INTERNAL_DEVICE_MCP_HOST/mcp
NPC_TANK_MQTT_URL=mqtt://REAL_INTERNAL_MQTT_HOST:1883
NPC_TANK_RUNTIME_ADVERTISED_URL=http://192.168.1.7:19103
```

从旧交付升级且保留既有 `.env` 时，初始化脚本不会覆盖该文件；必须手动补入
`NPC_TANK_RUNTIME_ADVERTISED_URL`。首次 seed 后 direct-container 的 control/advertised
端点属于部署身份的一部分，不能只编辑 `.env` 改址。当前包不提供自动改址流程；如需
变更，必须先备份，并在维护窗口使用单独评审的部署重建或数据迁移程序。

从带 PMS 管理令牌和 Runtime JWT 的旧包升级到本版本时，必须换用新交付 ZIP，保留
`.env`、`state/` 和数据库卷后重新运行 `init.sh`、`up.sh`。旧管理令牌、Runtime JWT
和 external catalog credential 文件可暂时留存用于回滚，但新 Compose 不再挂载、读取
或校验它们。

然后执行：

```bash
bash deploy/npc-tank/bin/init.sh
bash deploy/npc-tank/bin/up.sh
```

`up.sh` 会先验证交付包校验和、载入并核对固定镜像、检查明文内网策略和秘密文件，
随后启动服务、通过匿名内网 PMS API 执行幂等 seed，并运行只读真实链路 smoke test。
seed 等待部署 `ACTIVE`、实例 registration/heartbeat 新鲜及 Registry 发布完成；smoke
通过 PMS Web 匿名验证 `/api/v1` 原始管理路由和 SDAR projection，再从 Registry 的
advertised endpoint 匿名调用四个 NPC 读取操作，不调用移动、侦察、火控等变更操作。

PMS Web smoke 会先从容器网络执行，再用已经通过镜像校验的本地 PMS Web 镜像运行一次
`docker run --network host`（仅使用前序已核验存在的本地镜像），请求 `.env` 中实际发布的
`PMS_WEB_BIND_ADDRESS:PMS_WEB_PORT`；绑定地址为 `0.0.0.0`/`::` 时分别使用
`127.0.0.1`/`::1` 回环验证。
该检查不要求宿主安装 Node.js 或 curl，也不会从仓库拉取镜像。

SDAR 应匿名访问
`http://<PMS_WEB_HOST>:<PMS_WEB_PORT>/api/v1/registry/production/consumers/sdar/v1/sources/npc-tank-smpp/latest`
并使用 projection 中的 `serverEndpoint` 匿名调用 Runtime `/mcp`，无需也不应直连
`pms-api:8090`。
SDAR 客户端必须支持 credential mode `none`（两次请求均不发送 `Authorization`）；仍
强制 `credentialRef`/Bearer 的旧版客户端需先升级，不能配置伪造 token。

## 运维命令

```bash
bash deploy/npc-tank/bin/status.sh
bash deploy/npc-tank/bin/smoke.sh
bash deploy/npc-tank/bin/down.sh
```

`down.sh` 保留数据库卷、Worker 状态、合约报告、配置和秘密。升级或迁移前应备份
`.env`、`state/` 及 Docker 持久卷。

## 资格边界

本包提供完整、可重复加载的生产部署基础设施，但 Provider Package 的真实资源资格仍为
`pending`，production qualification 仍为 `NOT_CLAIMED`。Runtime 由 Compose 直接启动，
PMS 以 `runtimeAuthority=direct_container` 接纳；Runtime 自行注册和心跳，PMS Worker
跳过 PM2、发现 Catalog，并以 `registryAuthority=pms_worker` 发布 Registry。只有目标
内网的真实 Device MCP/MQTT 可达、数据新鲜且 Registry-backed 只读 smoke 通过后，才能
把该次现场部署视为已验证。
