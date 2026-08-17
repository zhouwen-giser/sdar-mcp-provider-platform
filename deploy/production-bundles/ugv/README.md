# UGV 生产环境独立部署包

本目录是 UGV 独立生产部署包的部署入口。正式交付 ZIP 会在此配置之外携带 5 个应用镜像、固定摘要的 PostgreSQL 17 镜像、离线镜像清单、完整源码归档和全包校验和；部署主机无需 Git、Node.js、源码构建工具或镜像仓库网络。

> 只有根目录 `DEPLOYABLE` 和本目录 `.bundle-images.env` 都标记为 `true` 的正式交付包才能启动。`stage-only` 包只用于审查，`bin/up.sh` 会在加载镜像前拒绝它。

## 服务与边界

部署常驻 8 个服务，并在首次启动或重复启动时运行一个幂等的 `pms-seed` 一次性任务：

| 服务                   | 用途                                  | 主机暴露                       |
| ---------------------- | ------------------------------------- | ------------------------------ |
| `pms-postgres`         | PMS 持久化                            | 不暴露                         |
| `pms-api`              | PMS API                               | 不暴露                         |
| `pms-worker`           | PMS Worker                            | 不暴露                         |
| `pms-web`              | PMS Web、Console V1 与 `/api/v1` 代理 | 默认 `0.0.0.0:8088`（仅内网）  |
| `ugv-adapter-postgres` | UGV Adapter 状态                      | 不暴露                         |
| `ugv-runtime-postgres` | UGV Runtime 状态、任务与事件          | 不暴露                         |
| `ugv-adapter`          | UGV Provider Adapter                  | 不暴露                         |
| `ugv-runtime`          | 匿名 MCP Runtime                      | 默认 `0.0.0.0:19100`（仅内网） |

数据库网络为 Docker 内部网络。这个交付物专用于已经由 VLAN、路由和主机防火墙完成隔离的严格内网，`ALLOW_INSECURE_INTERNAL_TRANSPORT=true` 是生产模式下使用明文传输的显式许可；Compose 另行固定 `PMS_EXTERNAL_RUNTIME_CATALOG_AUTH_MODE=anonymous_intranet`，明确允许 PMS Worker 无凭据发现 Compose Runtime Catalog。两个开关缺一不可，明文传输许可本身不会隐式取消 Catalog 鉴权。PMS 管理 API 与 Runtime MCP 不要求调用凭据，Runtime 与 Adapter RPC、Provider telemetry、Device MCP 和 MQTT 均不启用 TLS，也不生成、挂载或校验任何证书。数据库凭据及 Runtime 向 PMS 注册所需的实例绑定令牌仍使用本地秘密文件。所有应用镜像以非 root 用户运行、根文件系统只读，并禁用额外 Linux capabilities。

PMS Web 和 Runtime 默认绑定 `0.0.0.0`，供其他内网节点直接访问，不要求 HTTPS 反向代理或安全网关。`pms-api` 不发布主机端口；SDAR 通过 PMS Web 的同源 `/api/v1` 代理读取 consumer projection，Runtime `/mcp` 也允许匿名访问。由于这两个入口均无最终用户认证/RBAC，部署方必须确保 `8088`、`19100` 和所有容器网络端口只能从授权内网/VLAN 到达，禁止从公网或不受信网络路由进入。

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
- 生成绑定到固定 deployment/instance 的 Runtime registration 凭据；
- 创建权限为 `0700` 的状态目录和权限为 `0600` 的秘密文件。

它不会生成 TLS 证书，也不会生成、复制或猜测任何真实模拟器凭据。

编辑 `.env`，至少替换以下地址：

```dotenv
ALLOW_INSECURE_INTERNAL_TRANSPORT=true
UGV_SIM_DEVICE_MCP_URL=http://device-mcp.intranet.local/mcp
UGV_SIM_MQTT_URL=mqtt://mqtt.intranet.local:1883
UGV_MQTT_WIRE_MODE=ros_bridge_json
UGV_RUNTIME_ADVERTISED_URL=http://REPLACE_WITH_UGV_RUNTIME_HOST:19100
```

生产入口要求 `ALLOW_INSECURE_INTERNAL_TRANSPORT` 精确为 `true`，并接受配置后的 `http://` Device MCP 以及 `mqtt://`（或 `ws://`）MQTT 地址；它仍会拒绝占位域名、URL 内嵌凭据、URL fragment 和未明确的 wire mode。`UGV_RUNTIME_ADVERTISED_URL` 必须是其他内网消费者可达的 Runtime 基础地址（不带 `/mcp`），端口必须与 `UGV_RUNTIME_PORT` 一致。默认开箱路径假定真实端点无需 HTTP Header 或 MQTT 用户密码。

UGV Adapter 在本生产包中固定为 `UGV_EXECUTION_MODE=live`，因此只接受 Runtime/SDAR 的
LIVE 执行上下文；模式不一致会以 `UGV_EXECUTION_MODE_MISMATCH` 失败关闭。Device MCP mock
回退和 `vehicle_fire_weapon` 均固定禁用。`.env` 可配置单资源公开身份、只读调用重试、
Tool circuit breaker、停车确认阈值和 Operation failure budget；Fire 开关不作为现场可编辑
配置暴露。

### 可选：启用 Runtime OTLP 导出

OTLP 导出默认关闭。需要把 Runtime 的 traces、logs 和 metrics 推送到内网 OpenTelemetry
Collector 时，在 `.env` 中设置：

```dotenv
UGV_OTEL_ENABLED=true
UGV_OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector.intranet.local:4318
UGV_OTEL_EXPORTER_OTLP_TIMEOUT_MS=10000
```

`UGV_OTEL_EXPORTER_OTLP_ENDPOINT` 是 OTLP/HTTP 基础地址，通常使用端口 `4318`，不要包含
`/v1/traces`、`/v1/logs` 或 `/v1/metrics`；Runtime 会自动追加对应的 signal 路径。服务
实例 ID 固定为 PMS direct-container 实例 `production-ugv-direct-1`，不由现场配置。若
Collector 运行在部署主机上，应填写 Runtime 容器可达的主机内网地址，不能填写
`127.0.0.1` 或 `localhost`。

本包的严格内网策略固定使用明文 HTTP，不挂载 OTLP TLS CA/证书/私钥，也不发送 OTLP
认证 headers；Collector 及其监听端口必须只在隔离内网可达。超时值单位为毫秒，必须
在 `100` 到 `60000` 之间。旧 `.env` 不含上述键时仍按默认值保持关闭，兼容原
部署。修改配置后重新执行
`./bin/up.sh`，Compose 会重建配置发生变化的 `ugv-runtime`，其他未变化服务保持原状；
无需重新生成或发布交付包。

从旧交付升级且保留既有 `.env` 时，`init.sh` 不会覆盖该文件；必须手动补入
`UGV_RUNTIME_ADVERTISED_URL`。首次 seed 后 direct-container 的 control/advertised
端点属于部署身份的一部分，不能只编辑 `.env` 改址。当前包不提供自动改址流程；如需
变更，必须先备份，并在维护窗口使用单独评审的部署重建或数据迁移程序。

从带 PMS 管理令牌和 Runtime JWT 的旧包升级到本版本时，必须换用新交付 ZIP（ARM64
源码构建包则必须用新源码重新构建应用镜像），保留 `.env`、`runtime/` 和数据库卷后再
运行 `init.sh`、`up.sh`。旧的管理令牌、Runtime JWT 和 external catalog credential
文件可以暂时留存以便回滚，但新 Compose 不再挂载或读取它们，配置校验也不再要求它们。

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

`smoke.sh` 只执行读取：验证 8 个容器健康、3 个 PostgreSQL 实例可用、PMS Web 的匿名 `/api/v1` 原始管理代理、匿名 SDAR projection、`direct_container` RuntimeDeployment 为 `ACTIVE`、预期实例 registration/heartbeat 新鲜，并从 PMS Registry 发布的 advertised endpoint 匿名调用 Runtime 的 `server/discover`、`tools/list` 和以下 4 个读取工具：

PMS Web 检查会先从容器网络执行，再用已经通过镜像校验的本地 PMS Web 镜像运行一次
`docker run --network host`（仅使用前序已核验存在的本地镜像），请求 `.env` 中实际发布的
`PMS_WEB_BIND_ADDRESS:PMS_WEB_PORT`；绑定地址为 `0.0.0.0`/`::` 时分别使用
`127.0.0.1`/`::1` 回环验证。
该检查不要求宿主安装 Node.js 或 curl，也不会从仓库拉取镜像。

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

它要求 MQTT 与 Device MCP 都已连接、设备可用、至少接收一条 MQTT 数据且底盘状态未过期；不会调用导航、侦察、跟踪、激光或效应器等变更型操作。状态最大年龄由 `UGV_SMOKE_MAX_STATE_AGE_MS` 控制。

SDAR 应通过 `http://<PMS_WEB_HOST>:<PMS_WEB_PORT>/api/v1/registry/production/consumers/sdar/v1/sources/ugv-smpp/latest`
匿名获取 consumer projection，并使用其中的 `serverEndpoint` 匿名调用 Runtime `/mcp`。
不要直接暴露或访问 `pms-api:8090`。
SDAR 客户端必须支持 credential mode `none`（即两次请求都不发送 `Authorization`）；仍
强制配置 `credentialRef`/Bearer 的旧版 SDAR 客户端需先升级，不能用伪造 token 代替。

`down.sh` 只停止容器，保留 Docker 数据卷、Worker 状态、合同捕获文件和秘密。不要使用 `docker compose down --volumes`，除非已经确认要永久删除数据库。

## PMS 接入语义

`pms-seed` 先通过 PMS application/UoW 正式同步本包唯一的 UGV Provider Package，再通过匿名内网 PMS API 幂等创建或确认：

- Provider Type `isr.vehicle.ugv`
- vendor-managed Provider `isr.vehicle.ugv.ugv1`
- production Resource `vehicle:ugv1`
- Provider 与 Resource 的绑定
- `direct_container` RuntimeDeployment `production-ugv-direct`
- 预期 Runtime 实例 `production-ugv-direct-1`

本包中的 Runtime 仍由 Compose 直接启动和重启；PMS Worker 对该部署识别为 `runtimeAuthority=direct_container`，不会通过 PM2 启动第二个 Runtime。Runtime 使用实例绑定令牌自行 register、持续 heartbeat；Worker 通过控制端点检查健康、发现 Catalog，并以 `registryAuthority=pms_worker` 发布配置的内网 advertised endpoint。Runtime 数据库和运行配置仍由 Compose/环境直接管理，不切换到 PMS Config/DB authority。

## 数据、备份与轮换

持久数据位于 3 个具名 Docker 卷：`pms-postgres-data`、`ugv-adapter-postgres-data`、`ugv-runtime-postgres-data`；此外 `runtime/pms-worker-state` 和 `runtime/ugv-contract-reports` 是本地持久目录。备份必须同时覆盖数据库一致性备份、这两个目录、`.env` 和 `secrets/`，并按组织的密钥托管策略加密保存。

数据库密码或 Runtime registration 令牌的轮换涉及多个内部消费者，不能只替换单个文件；应先备份，在维护窗口停止服务，并按迁移方案整体轮换。重复运行 `init.sh` 会保留已有随机秘密，不会自动轮换。

该包是单主机部署，不提供 PostgreSQL 高可用、跨主机编排、自动备份、集中日志或秘密管理系统集成；生产运维需在包外补齐这些能力。它也不提供传输加密，内网隔离和端口访问控制属于部署前置条件。容器日志使用 `json-file`，单文件 10 MiB、保留 5 个轮转文件。

## 已知资格边界

部署包继承的 UGV real-resource 资格状态为 `pending`，并不等同于完成生产认证。此前真实接口验证观察到 `ros_bridge_json` 兼容模式以及 topic/QoS/envelope 的混合差异，因此在上游统一消息封装和 QoS 前仍属于部分资格。交付包不会把这种状态提升为 `qualified`，也不会自动执行任何真实设备副作用测试。

常见前置校验错误以 `BLOCKED_CONFIGURATION` 开头；镜像校验错误以 `BLOCKED_BUNDLE_IMAGE` 开头。修复配置或恢复完整交付文件后重新运行 `bin/up.sh` 即可。
