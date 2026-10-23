# 无人车 MCP 控制台

独立中文控制台，默认 HTTP 19101。通过 SMPP 冻结 MCP 2026-07-28 连接当前无人车，支持坐标输入、简图、导航、侦察、检查、云台、跟踪、任务控制、人工观察决策与导航计划调整。目录和实际可用性决定能否提交。

## 部署包安装

Linux 主机需要 Docker Compose、Node.js 22、iproute2，且已有运行中的 SMPP Runtime 与 PostgreSQL。

```bash
sha256sum -c SHA256SUMS
docker load -i image.tar
export UGV_CONSOLE_IMAGE='<manifest.json 中的 image>'
node deploy.mjs
```

脚本默认查找当前站点容器，可用 `UGV_CONSOLE_RUNTIME_CONTAINER`、`UGV_CONSOLE_POSTGRES_CONTAINER` 覆盖。Runtime 中的 `GOWM_DATABASE_URL_FILE` 用于确定已有数据库，数据库管理员通过现有 PostgreSQL 容器的本地 psql 建立独立 `ugv_console_operator` 账号及 `ugv_control_console` schema。其余业务表与迁移不参与此操作。

面板入口使用专用桥接网络，默认网段 `10.252.244.0/24`，通过 `UGV_CONSOLE_EDGE_SUBNET` 可指定其他专用网段。部署前会检查已有 Docker 子网、主机路由以及 `UGV_CONSOLE_PROTECTED_ADDRESSES`（默认当前设备 `192.168.2.63`），冲突时拒绝创建。共享数据库网络保持内部网络，入口网络不采用 Docker 自动分配地址。

默认配置和密钥目录：`~/.smpp-debug/ugv-control-console`。脚本生成随机初始密码、密码哈希、会话密钥和数据库密码。账号及初始密码保存在权限 0600 的 `operator-login.txt`，密码不会输出到部署日志。再次运行会复用密钥与账号。

打开 `deployment.json` 中的访问地址，例如 `http://17.26.1.20:19101`。默认 `UGV_CONSOLE_PROTOCOL=http`，局域网直接访问。额外主机名通过 `UGV_CONSOLE_PUBLIC_HOSTS` 逗号分隔配置。登录保持 HttpOnly、SameSite=Strict 会话及同源校验；HTTP 会话不设置 Secure 属性。

已有上游认证时，用 `UGV_CONSOLE_UPSTREAM_AUTHORIZATION_FILE` 提供完整 Authorization 头值。该文件仅挂载到后端，不会发送至浏览器。面板单账号登录用于本地访问及审计，上游 Task 授权域独立保持一致。

## 操作

1. 登录后检查设备链路、数据源时间和目录。
2. 选择控制表单，按“经度, 纬度”逐行输入 WGS84 坐标。也支持 `lon: …, lat: …`。
3. 简图中的表单预览仅用于核对；执行后通过 Task、业务对象和证据查看实际结果。
4. 任务记录由各浏览器共享。已有任务可通过 Task ID 导入。
5. 暂停、恢复、取消、人工答复和路线调整操作当前 Task；受理回执后继续等待状态确认。
6. 紧急停止有独立按钮与提交路径，其实际停止结果仍由 MCP Task 确认。
7. 回执丢失时命令显示“结果未确认”；重连和重启不会重发。通过已知 Task ID 导入并核实原执行，禁止将不确定请求随意作为新命令重发。
8. 下载任务报告包含完整业务对象读取结果、缺失证据和不可用原因。Artifact 可单独读取完整内容。像素或缺少转换的本地几何不会画成经纬度。

历史任务超过 Runtime 保留期可能无法再次查询，面板仍保留最后一次缓存和命令回执。列表范围为本面板及导入任务。

## 源码构建与验证

从仓库根目录：

```bash
pnpm install --frozen-lockfile
pnpm --filter @sdar/ugv-control-console build
# 下列测试只连接专有隔离 PostgreSQL/MQTT 配置，不使用站点设备。
SMPP_INSPECTION_TEST_CONFIG_FILE=/absolute/private/config.json pnpm --filter @sdar/ugv-control-console test
SMPP_INSPECTION_TEST_CONFIG_FILE=/absolute/private/config.json pnpm --filter @sdar/ugv-control-console test:e2e
docker build -f deploy/ugv-control-console/Dockerfile --build-arg VCS_REF="$(git rev-parse HEAD)" -t smpp/ugv-control-console:local .
```

独立配置项见 `server/config.ts`。默认 HTTP 绑定 `0.0.0.0`，来源白名单使用 HTTP 地址。开发时可设置 `UGV_CONSOLE_INSECURE_LOCAL=true` 将绑定限制为 loopback。

## 更新与回退

更新时设置新镜像再次运行部署脚本。密钥和数据库记录复用，上次镜像配置保存在 `previous-compose.json`。

```bash
docker compose -p smpp-ugv-console -f ~/.smpp-debug/ugv-control-console/previous-compose.json up -d --no-build
# 停用面板
docker compose -p smpp-ugv-console -f ~/.smpp-debug/ugv-control-console/compose.json stop
```

数据库 schema、登录文件、证书与命令记录保留。部署后核实 `/health/ready`、登录、目录、状态和已导入任务；现场动作由操作员明确发起并保留实际结果。

## 当前站点的 Docker 转发修复

若 Docker 用户桥的 FORWARD 规则缺失，先运行 `node repair-network.mjs` 审阅解析出的路径，再运行 `node repair-network.mjs --apply`。该脚本仅允许面板容器访问指定 Runtime 8080、PostgreSQL 5432，以及已发布的面板 19101；规则使用独立 comment，写入 `network-plan.json` / `network-receipt.json`。本机回环访问需要相应桥的 route_localnet。脚本通过短暂的 NET_ADMIN 辅助容器设置规则，面板容器本身没有该权限。

容器 IP 变化或 Docker/主机重启后重新检查并运行该脚本。`--remove` 只撤回本面板标记的规则，数据库、其他容器规则与主机策略保留。
