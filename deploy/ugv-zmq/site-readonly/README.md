# 现场只读与路线预览

本部署使用真实三路 ZMQ SUB、现有 GOWM 受限账号、SMPP 独立观测数据库及 7879。
Provider 1.1.0 / `zmq_v1_1_0_readonly_13` 的六个控制工具均禁用。
Runtime 识别精确目录后也拒绝控制和生命周期命令，停用任务恢复、调度、命令派发及清理扫描。
历史任务查询使用原身份域和原快照；源时钟、场景身份和覆盖证据未知时明确保留未知。

## 配置与启动

先由观测库所有者安装 `deploy/ugv-zmq/migrations/001_observation_archive.sql`，再授予应用账号
Schema USAGE、全部表 SELECT、partition/session INSERT/UPDATE 及 entry INSERT。
应用账号无 DDL 权限；Provider 启动只验证现有结构。观测库不能使用 GOWM 业务数据库。
GOWM 沿用现有 `ugv_smpp_app`、设备、binding、service 和 source-session 配置。
现有 source-session 的名称可含 mqtt；这是存储逻辑身份，不作为 ZMQ producer epoch。

私有配置文件权限 0600；数据库 URL 和密码不能进入源码、部署包或日志。
Provider JSON 使用 `mode: site_readonly`、databaseUrl、observationDatabaseUrl、profile、
observerSettings、contractSha256、host、port；不允许 controlSettings。
Provider/resource 是现有逻辑绑定，simulationId 和 controllerSystemId 保持 null。
profile.planner.policy=retain，endpoint=`http://192.168.2.63:7879`。
`plannerFrame: airport_south_positive_v1` 显式选择已有场景转换：
锚点 106.81485/29.7195、xScale 111320、yScale 110540、世界 Y 向南。
该配置不是场景 ID 的确认；其他场景需要独立核验转换。

候选 Provider 绑定 127.0.0.1:19109，Runtime 绑定 127.0.0.1:19110，面板绑定
127.0.0.1:19111。启动前检查端口；冲突必须失败。compose 的 host 网络不额外发布端口。
Runtime 沿用既有 GOWM 模式、Provider ID、授权域和合同目录，关闭候选 PMS 自动注册。
面板设置 HTTP、对应 origins、MCP URL `http://127.0.0.1:19110/mcp`，复用操作员凭据和命令库。
候选可设置 `UGV_CONSOLE_SESSION_COOKIE_NAME=ugv_site_candidate` 隔离同主机不同端口的会话。
提供 compose 中要求的私有文件和三个固定镜像后运行：

```sh
docker compose --env-file /private/site-images.env -p smpp-zmq-site-readonly -f deploy/ugv-zmq/site-readonly/compose.yaml up -d
```

## 规划与记录

新增 MCP `vehicle_zmq_plan_route(resourceId,start,waypoints,density)`；WGS84 经度在前。
起点只验证返回路线，规划服务按其当前车辆生成候选。面板没有新鲜定位时需人工填写。
只发送 Socket.IO plan_route；消费 route_candidates，不使用仪表盘实体状态作为设备定位。
三秒超时，在同一观测库中按规范化端点取得 advisory lock；外部客户端仍可能广播候选。
严格校验起终点和途经点顺序，沿用 20 米几何匹配容差。
没有请求 ID，关联强度固定 geometry_only_no_request_id；结果固定 preview_only。
保留实际路线、完整所选响应帧、请求/转换/来源哈希和时间；单帧超过 256 KiB 明确拒绝。
面板先写 commandId 和参数，再请求 MCP 并保存结果；同 ID 不同参数拒绝。
预览不生成 provider_task、原生任务或已采用路线。失联、重启和刷新不自动重发。

MCP 保持冻结 2026-07-28，旧目录 1.0.1 和 SDAR 绑定保留。新目录不能替代旧巡逻能力。

## 验证与交接

```sh
node --import tsx scripts/ugv-zmq/site-catalog.ts --check
SMPP_ZMQ_OWNER_CONFIG_FILE=/private/owner.json UGV_ZMQ_SITE_PROFILE_FILE=/private/profile.json node --import tsx scripts/ugv-zmq/site-handoff-check.ts
```

owner.json 为现有 GOWM 环境变量对象；profile.json 为对应部署 Profile，两者权限 0600。
检查使用真实 owner pool，报告任务、未决接纳、Provider 执行、原生占用、未确认命令及租约。
exit 2 表示交接条件未满足；databaseIdle 只是瞬时观察，switchAuthorized 始终 false。
替换 19100/19101 前还需关闭旧准入、确认旧写端停止和设备空闲，保留原配置、卷和签名密钥。
满足条件后将面板设为 0.0.0.0:19101 和相应 HTTP origins。旧依赖故障时不声明回退后可控。

当前部署若被旧活动任务阻塞，保持候选运行。停止候选、恢复上一镜像只改变应用服务，
保留观测卷、命令、审计、任务和版本历史。过期 Task handle 返回 TASK_EXPIRED，不能延长 TTL
或改写执行身份来通过验收。
