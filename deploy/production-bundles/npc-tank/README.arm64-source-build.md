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
- gRPC 相关依赖下载站点；
- GitHub 和 GitHub Releases。使用组织代理或内部镜像时，应根据构建日志放行等价地址。

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

| 服务                   | 用途                           | 主机暴露                     |
| ---------------------- | ------------------------------ | ---------------------------- |
| `pms-postgres`         | PMS 持久化                     | 不暴露                       |
| `pms-api`              | PMS API                        | 不暴露                       |
| `pms-worker`           | PMS Worker                     | 不暴露                       |
| `pms-web`              | PMS Web 与 Console V1 同源代理 | 默认 `0.0.0.0:8089`，仅内网  |
| `npc-adapter-postgres` | NPC Adapter 状态               | 不暴露                       |
| `npc-runtime-postgres` | NPC Runtime 状态、任务与事件   | 不暴露                       |
| `npc-tank-adapter`     | NPC Tank Provider Adapter      | 不暴露                       |
| `npc-tank-runtime`     | JWT 保护的 MCP Runtime         | 默认 `0.0.0.0:19103`，仅内网 |

三个 PostgreSQL 服务只位于 Docker 内部网络。PMS Web 当前没有最终用户认证闭环，部署
方必须通过 VLAN、路由和主机防火墙，把 `8089`、`19103` 及容器网络限制在授权内网内，
不得路由到办公公网、互联网或其他不受信网段。Runtime 仍强制 JWT；PMS、数据库和
Runtime 分别使用独立秘密。

## 目标主机要求

- 原生 ARM64/AArch64 Linux Docker 主机；构建脚本会拒绝非 Linux ARM64 Docker server；
- Docker Engine、可用的 BuildKit 和 Docker Compose v2；
- Bash、GNU tar、OpenSSL、`sha256sum`、`stat`、`awk` 和常用 POSIX 工具；
- UID 1000，或由 root 初始化并把运行状态和秘密归属设置为 UID/GID 1000；
- 足够容纳源码、BuildKit cache、六个本地镜像、五个持久数据区域和日志的磁盘空间；
- 到真实内网 Device MCP、MQTT 端点的 DNS、路由、防火墙和时钟同步正常；
- 首次构建具备前述 Docker Hub、npm、gRPC 依赖站点和 GitHub HTTPS 出网能力。

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

`init.sh` 从 `.env.example` 创建 `.env`，随机生成三个 PostgreSQL 数据库凭据、PMS
管理凭据和 Runtime JWT HS256 密钥，并把状态目录和秘密文件限制为 UID 1000 可读。
它不会生成 TLS 证书或私钥，也不会生成、复制或猜测真实 NPC 端点凭据。重复执行会保留
已有秘密，不会自动轮换。

编辑 `deploy/npc-tank/.env`，至少替换真实内网端点：

```dotenv
ALLOW_INSECURE_INTERNAL_TRANSPORT=true
NPC_TANK_DEVICE_MCP_URL=http://npc-device-mcp.intranet.local/mcp
NPC_TANK_MQTT_URL=mqtt://mqtt.intranet.local:1883
```

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

`smoke.sh` 检查八个容器、三个 PostgreSQL 实例、PMS Web 同源代理、JWT Runtime 和
真实 Device MCP/MQTT 连接，并只调用以下四个读取工具：

- `vehicle_get_state`
- `vehicle_get_capabilities`
- `vehicle_get_payload_status`
- `vehicle_get_targets`

它不会调用移动、导航、侦察、跟踪、火控、效应器或其他变更操作；真实端点不可达时会
失败，不会用 mock 数据给出成功结果。当前 NPC smoke 不单独断言 MQTT telemetry 的
采样新鲜度，因此通过结果只代表连接和四个只读调用通过，不能扩展声称新鲜数据已验证。

`down.sh` 只停止容器，保留 PostgreSQL 数据卷、Worker 状态、合约报告、`.env` 和秘密。
除非已经确认要永久删除数据库，否则不要使用 `docker compose down --volumes`。

## 秘密、备份与资格边界

秘密和状态目录必须保持初始化脚本设置的 UID 1000、目录 `0700`、文件 `0600` 权限。
备份至少覆盖三个数据库的一致性备份、`deploy/npc-tank/.env`、配置的 `state/` 目录和
Docker 持久卷，并按组织的密钥托管策略加密保存。Runtime JWT 或数据库密码轮换需要
协调多个消费者，应在维护窗口按整体迁移方案执行。

本包提供从精确源码在原生 ARM64 主机生成部署镜像的路径，但不把本机构建结果自动认定
为生产认证。NPC Tank Provider Package 的 real-resource 状态仍为 `pending`。直接
Runtime 容器是当前 vendor-managed 运行权威，PMS Registry 和 platform-managed
Runtime 权威闭环均为 `not_configured`。

只有目标主机上的源码构建、八服务健康检查、PMS seed 和真实只读 smoke 全部通过后，
才能记录该次现场部署已经验证；该结果不会把全局资格状态提升为 `qualified`，也不会
授权执行移动、火控或其他真实设备副作用测试。
