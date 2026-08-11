# UGV 生产环境独立部署包

本目录是 UGV 独立生产部署包的部署入口。正式交付 ZIP 会在此配置之外携带 5 个应用镜像、固定摘要的 PostgreSQL 17 镜像、离线镜像清单、完整源码归档和全包校验和；部署主机无需 Git、Node.js、源码构建工具或镜像仓库网络。

> 只有根目录 `DEPLOYABLE` 和本目录 `.bundle-images.env` 都标记为 `true` 的正式交付包才能启动。`stage-only` 包只用于审查，`bin/up.sh` 会在加载镜像前拒绝它。

## 服务与边界

部署常驻 8 个服务，并在首次启动或重复启动时运行一个幂等的 `pms-seed` 一次性任务：

| 服务                   | 用途                           | 主机暴露                       |
| ---------------------- | ------------------------------ | ------------------------------ |
| `pms-postgres`         | PMS 持久化                     | 不暴露                         |
| `pms-api`              | PMS API                        | 不暴露                         |
| `pms-worker`           | PMS Worker                     | 不暴露                         |
| `pms-web`              | PMS Web 与 Console V1 同源代理 | 默认 `0.0.0.0:8088`（仅内网）  |
| `ugv-adapter-postgres` | UGV Adapter 状态               | 不暴露                         |
| `ugv-runtime-postgres` | UGV Runtime 状态、任务与事件   | 不暴露                         |
| `ugv-adapter`          | UGV Provider Adapter           | 不暴露                         |
| `ugv-runtime`          | JWT 保护的 MCP Runtime         | 默认 `0.0.0.0:19100`（仅内网） |

数据库网络为 Docker 内部网络。这个交付物专用于已经由 VLAN、路由和主机防火墙完成隔离的严格内网，`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 是生产模式下使用明文传输的显式许可：Runtime 与 Adapter RPC、Provider telemetry、Device MCP 和 MQTT 均不启用 TLS，也不生成、挂载或校验任何证书。Runtime 仍强制 JWT，数据库和 PMS 管理接口仍使用各自的随机秘密。所有应用镜像以非 root 用户运行、根文件系统只读，并禁用额外 Linux capabilities。

PMS Web 和 Runtime 默认绑定 `0.0.0.0`，供其他内网节点直接访问，不要求 HTTPS 反向代理或安全网关。当前 Console V1 的最终用户认证/RBAC 尚未在 Web 层闭环，因此必须由部署方确保这些端口只能从授权内网/VLAN 到达，禁止从公网或不受信网络路由进入；Runtime 的 JWT 签名密钥不能分发给调用方。

## 主机要求

- Linux 主机，能够运行交付镜像对应的 CPU 架构
- Bash、OpenSSL、`sha256sum`
- Docker Engine 与 Docker Compose v2（支持 `docker compose up --wait`）
- 初始化由 UID 1000 执行，或由 root 执行并将运行文件归属设置为 UID/GID 1000
- 到真实内网 Device MCP 与 MQTT 端点的 DNS、路由、防火墙和时钟同步均正常

建议在专用主机上部署。默认资源上限合计约 5 GiB 内存，不包含 Docker、页缓存和外部代理开销。

## 首次部署

先在解压后的交付包根目录验证旁路 SHA-256 文件，再进入本目录。例如：

```bash
sha256sum --check sdar-ugv-production-delivery.zip.sha256
unzip sdar-ugv-production-delivery.zip
cd sdar-ugv-production/deploy/ugv
```

若 ZIP 已由可信发布流程解压，可从本目录开始：

```bash
sudo ./bin/init.sh
```

`init.sh` 会：

- 从 `.env.example` 创建 `.env`（如不存在）；
- 生成 3 个 PostgreSQL 数据库的独立随机凭据；
- 生成 PMS 管理令牌、Runtime JWT HS256 密钥；
- 创建权限为 `0700` 的状态目录和权限为 `0600` 的秘密文件。

它不会生成 TLS 证书，也不会生成、复制或猜测任何真实模拟器凭据。

编辑 `.env`，至少替换以下地址：

```dotenv
ALLOW_INSECURE_INTERNAL_TRANSPORT=true
UGV_SIM_DEVICE_MCP_URL=http://device-mcp.intranet.local/mcp
UGV_SIM_MQTT_URL=mqtt://mqtt.intranet.local:1883
UGV_MQTT_WIRE_MODE=ros_bridge_json
```

生产入口要求 `ALLOW_INSECURE_INTERNAL_TRANSPORT` 精确为 `true`，并接受配置后的 `http://` Device MCP 以及 `mqtt://`（或 `ws://`）MQTT 地址；它仍会拒绝占位域名、URL 内嵌凭据、URL fragment 和未明确的 wire mode。默认开箱路径假定这两个严格内网端点无需 HTTP Header 或 MQTT 用户密码，不要求任何外部文件。底层 Provider 支持可选鉴权，但若真实端点确有鉴权，应通过经过审查的 Compose override 挂载相应秘密，而不是把秘密写入 `.env`。

初始化后的权限可用以下命令复核：

```bash
sudo chown -R 1000:1000 .env secrets runtime
sudo find secrets runtime -type d -exec chmod 0700 {} +
sudo find secrets runtime -type f -exec chmod 0600 {} +
sudo chmod 0600 .env
```

确认 `.env` 中没有镜像身份键；`BUNDLE_REVISION`、`POSTGRES_IMAGE`、`POSTGRES_DIGEST`、`POSTGRES_DIGEST12` 和 `BUNDLE_DEPLOYABLE` 只能来自发布流程生成的只读 `.bundle-images.env`。

启动：

```bash
./bin/up.sh
```

启动脚本依次校验包状态和秘密文件、验证全包校验和、离线加载并核对 6 个镜像、启动 8 个常驻服务、执行幂等 PMS seed，最后运行只读冒烟检查。任何一步失败都会非零退出，不会回退到 mock、在线拉取或本机源码构建。

## 日常运维

```bash
./bin/status.sh
./bin/smoke.sh
./bin/down.sh
```

`smoke.sh` 只执行读取：验证 8 个容器健康、3 个 PostgreSQL 实例可用、PMS Web 同源代理边界，以及 JWT Runtime 的 `server/discover`、`tools/list` 和以下 4 个读取工具：

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

它要求 MQTT 与 Device MCP 都已连接、设备可用、至少接收一条 MQTT 数据且底盘状态未过期；不会调用导航、侦察、跟踪、激光或效应器等变更型操作。状态最大年龄由 `UGV_SMOKE_MAX_STATE_AGE_MS` 控制。

`down.sh` 只停止容器，保留 Docker 数据卷、Worker 状态、合同捕获文件和秘密。不要使用 `docker compose down --volumes`，除非已经确认要永久删除数据库。

## PMS 接入语义

`pms-seed` 先通过 PMS application/UoW 正式同步本包唯一的 UGV Provider Package，再通过带管理员认证的 PMS API 幂等创建或确认：

- Provider Type `isr.vehicle.ugv`
- vendor-managed Provider `isr.vehicle.ugv.ugv1`
- production Resource `vehicle:ugv1`
- Provider 与 Resource 的绑定

本包中的 Runtime 是 Compose 直接管理的 vendor-managed Runtime。seed 不创建 `RuntimeDeployment`，也不声称 PMS Worker 已发布 Catalog/Registry 权威；当前包没有配置 platform-managed Runtime 和 Registry 闭环，这两类权威状态均为 `not_configured`。PMS Worker 仍完整包含在部署中，供 PMS 控制面与后续受支持的部署路径使用。

## 数据、备份与轮换

持久数据位于 3 个具名 Docker 卷：`pms-postgres-data`、`ugv-adapter-postgres-data`、`ugv-runtime-postgres-data`；此外 `runtime/pms-worker-state` 和 `runtime/ugv-contract-reports` 是本地持久目录。备份必须同时覆盖数据库一致性备份、这两个目录、`.env` 和 `secrets/`，并按组织的密钥托管策略加密保存。

Runtime JWT 或数据库密码的轮换涉及多个消费者，不能只替换单个文件；应先备份，在维护窗口停止服务，并按迁移方案整体轮换。重复运行 `init.sh` 会保留已有随机秘密，不会自动轮换。

该包是单主机部署，不提供 PostgreSQL 高可用、跨主机编排、自动备份、集中日志或秘密管理系统集成；生产运维需在包外补齐这些能力。它也不提供传输加密，内网隔离和端口访问控制属于部署前置条件。容器日志使用 `json-file`，单文件 10 MiB、保留 5 个轮转文件。

## 已知资格边界

部署包继承的 UGV real-resource 资格状态为 `pending`，并不等同于完成生产认证。此前真实接口验证观察到 `ros_bridge_json` 兼容模式以及 topic/QoS/envelope 的混合差异，因此在上游统一消息封装和 QoS 前仍属于部分资格。交付包不会把这种状态提升为 `qualified`，也不会自动执行任何真实设备副作用测试。

常见前置校验错误以 `BLOCKED_CONFIGURATION` 开头；镜像校验错误以 `BLOCKED_BUNDLE_IMAGE` 开头。修复配置或恢复完整交付文件后重新运行 `bin/up.sh` 即可。
