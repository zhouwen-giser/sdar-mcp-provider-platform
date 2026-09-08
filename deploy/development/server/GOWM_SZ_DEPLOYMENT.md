# sz-gowm：使用现有 GOWM 业务数据库

本包用于 sz-gowm 本机。Runtime 与 UGV Adapter 共用现有 `postgres:5432/gowm` 的 `ugv_smpp`；加入现有网络 `gowm-analysis-dev-d2bf0ea98e_default`。不创建 PostgreSQL 容器或数据库卷，不管理 GOWM/GDPS/GSAP 容器。

## 已核对的现场配置

GOWM 入口 `/mnt/data/gowm-current`，部署包摘要 `1ad2edcc2cbe0859e4481401e8cbc82548d35aa89ab9b688cc30caf3c1147e05`，正式迁移至 079。主档 `ugv:ugv`、data scope `default`、entity ID `ugv`、MQTT `mqtt://192.168.2.63:1883`。SMPP 使用独立 MQTT client ID，避免抢占 GOWM 会话。

最新 GOWM 初始化已提供 `ugv_smpp_app`/`ugv_sdar_app` 和私密连接文件；SMPP 原生业务表及服务绑定仍需安装。准备入口调用现有 GOWM 容器中的正式 SMPP 域安装器，再通过 `resolveBusinessDeviceContext` 绑定已登记设备。不会安装 SDAR 域或 vector，不覆盖原 GOWM 环境。设备 MCP 地址沿用 SMPP 模板的 `http://192.168.2.63:19000/mcp`，本次未向它发起控制或合同探测。

优先使用 `pnpm package:united-server` 生成的联合包入口，它会自动导入既有私密连接文件。以下为独立入口，在准备之前必须完成该连接文件导入。

## 首次启动

在 sz-gowm 上将归档解压到新的空目录，进入解压目录。需要 Node.js 22、Docker Compose 和现有 GOWM 容器访问权限。

```sh
# 只读预检：核对容器、网络、GOWM 核心/安装器合同与设备。
sudo node deploy/development/server/prepare-gowm.mjs

# 一次性准备；可重复执行，不轮换已有角色密码。
sudo node deploy/development/server/prepare-gowm.mjs --apply

# 构建本包应用镜像并启动；只操作本包 smpp-gowm 项目。
bash deploy/development/server/deploy.sh up
bash deploy/development/server/deploy.sh status
```

`--apply` 会在既有 database 中安装 SMPP 业务 Schema，使用 GOWM 管理的 `ugv_smpp_app`，复用 `gowm_device_reader` 角色，授予 ugv_smpp 数据/序列及 Mission/目标写权限。运行时不会持有管理员凭据。管理员连接只在现有 GOWM 容器内读取，不导出到本包。

先将 GOWM `business-connections.env` 中的 `SMPP_DATABASE_URL` 私密导入服务器本包 `deploy/development/server/config/gowm.url`（0600，UID 1000）；真实绑定写入 `gowm-binding.json`。两个应用只读挂载配置目录并使用同一连接文件。角色已存在但没有对应 secret 时拒绝继续，不重设密码。初始化中断保留 secret 供重试；已有 secret 与角色不匹配时拒绝继续。

归档包含 `DEPLOYMENT_PROFILE=sz-gowm` 标记，启动默认复制 `.env.gowm.example`，已有 `.env` 不覆盖。标记存在时旧 standalone 配置会报错，不会悄悄创建独立数据库。可在启动前编辑 `.env` 调整 MCP 监听端口等参数；设备、服务和 Provider/resource 身份必须与 `gowm-site.json` 和登记结果一致。当前 MCP 端口为 19100。

## 变更与更新

本包准备配置采用 `smpp.sz-gowm.ugv` / `isr.vehicle.ugv.ugv` / `vehicle:ugv`。服务绑定是新消费者身份，未冒充现场已有绑定。首次登记后由启动脚本读取实际 binding UUID，没有预造 UUID 或默认 ugv1。以后更新包时保留 `.env` 与 `config/`；若现场已有其他消费者绑定，初始化报冲突，先核对归属。

启动先加载应用配置，再由应用校验真实存储合同及绑定；此后才建立设备业务连接。`config` 只检查部署配置，不代表数据库已初始化或设备可用。共享 GOWM 的统一业务视图目前还依赖 SDAR 域，本包仅安装 SMPP 域，因此下半链可通过原生 ugv_smpp / gowm_execution 查询，不声称 SDAR 视图已安装。

`down` 仅停止本包应用并保留 state 卷。不会删除旧 SMPP 数据库、GOWM 数据或网络。接管同一设备前，处理旧实例的活跃/不确定任务并停止旧写入方。联合包入口与现场部署结果见 deploy/united/README.md 及本次联合部署报告。
