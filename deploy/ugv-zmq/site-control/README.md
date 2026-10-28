# 现场控制 1.2.0

目录为 `zmq_v1_2_0_site_control_13`，包含六项 Task-required 控制、六项读取和 7879 同步预览。
仅用于已完成写端交接的本项目；旧 1.0.1 隔离合同、1.1.0 只读目录和 SDAR 绑定保留。

## 交接

维护权限 0600 的管理配置，包含 `ownerEnvironmentFile`、`profileFile` 和
`oldWriterContainers`（Runtime 在前、适配器在后）。profile 使用
`schemaVersion: ugv.zmq-site-deployment/1`、`executionDomain: {mode: live, simulationId: null}`；
省略 controllerSystemId 时编码为 0，车辆 systemId 必须保持站点确认值 1。
保留既有 GOWM 受限账号、device/binding/service/source-session，不修改冻结迁移。

先核实旧写端的自动启动来源。备份旧 compose 后禁用其 Runtime/适配器服务的默认 profile，
将 restart 改为 no；确认无其他监督器会拉起这些 Docker 服务。保存原文件和修改后哈希。
PMS 注册配置及其他项目保持原值。CLI 不会操作未知编排系统，不能仅以停止一个进程代替交接。

```sh
node --import tsx scripts/ugv-zmq/site-control-handoff.ts plan --config /private/handoff.json --plan /private/plan.json
node --import tsx scripts/ugv-zmq/site-control-handoff.ts apply --config /private/handoff.json --plan /private/plan.json --grant /private/grant.json --plan-hash ACTUAL_PLAN_SHA256 --command-id UNIQUE_UUID --actor operator --reason '旧链路退役，设备结果未知'
node --import tsx scripts/ugv-zmq/site-control-handoff.ts verify --config /private/handoff.json --grant /private/grant.json
```

apply 固定旧容器身份/镜像、禁用自动重启并停止旧写端，再检查数据库快照。
快照或版本变化会拒绝；保持旧写端停止后重新 plan，并使用新的 commandId。
相同 commandId/参数重试返回原凭据；不同内容拒绝。无终态的旧任务被记为技术失败、设备结果未知，
未完成命令拒绝，不重新派发。原报告、Context、事件与原身份保留。
原生 ZMQ 未决任务或未确认接纳不能由旧 MQTT 退役路径清除。

## 配置

Provider JSON：mode=site_control、现有数据库和独立观测库 URL、profile、observerSettings、
controlSettings、plannerFrame=airport_south_positive_v1、host=127.0.0.1、port=19109、
handoffGrantFile=/run/secrets/handoff.json、management={port:19108,jwtSecretFile:/run/secrets/site-jwt.key}。
controlSettings 使用现有 `ugv.zmq-control-settings/1`，mode=site_control；siteEndpoints 精确列出六个
现场 tcp URL，handoffGrantHash 为已提交 grant 的 canonical JSON SHA256。
先取得端点锁再建立命令 socket；每次发送重新核实身份、租约、期限及组件状态。
运行源时钟未确认不禁止所有操作；具体所需状态缺失、过期或外部占用会返回对应原因。

Runtime 支持 AUTH_MODE=jwt_hs256，或显式 AUTH_MODE=site_anonymous。
site_anonymous 必须同时开启 ALLOW_INSECURE_INTERNAL_TRANSPORT=true，并保留 JWT_HS256_SECRET 验证可选令牌。
无凭据请求固定 tenant=default、subject=development-anonymous，忽略客户端身份头；历史 authorizationContextHash 不变。
匿名请求不获得操作员身份；人工答复仍由已登录面板的服务端 JWT 提交。携带无效 JWT 时拒绝，不回退匿名。
内部管理接口的独立认证保持不变。
live 不携带 simulation header。令牌及签名密钥只保留在服务器，禁止写入浏览器或交付包。
禁用候选 PMS 自动注册；保留正式实例配置与轨迹签名密钥。
建议 SCHEDULER_POLL_MS=100、RECOVERY_POLL_MS=500；六项控制默认立即开始、60 秒启动容差、300 秒执行上限。

面板使用 HTTP。候选 127.0.0.1:19111 → MCP 127.0.0.1:19110；管理入口仅 127.0.0.1:19108。
正式端口为 19100/19101；局域网 origins 必须包含实际站点地址。
UGV_CONSOLE_SITE_MANAGEMENT_URL 指向固定管理入口，不接收浏览器提供的上游 URL。
UGV_CONSOLE_UPSTREAM_AUTHORIZATION_FILE=/run/secrets/upstream-authorization；内容为 Bearer 加已签名 token。
UGV_CONSOLE_AUTHORITY_KEY 固定到原租户/主体/Provider；不包含 token，使换端口或轮换凭据不隐藏记录。
UGV_CONSOLE_HISTORY_DOMAINS 可列入经核实的旧 console domain（逗号分隔 SHA256），原记录保持不变。

```sh
docker compose --env-file /private/site-images.env -p smpp-zmq-site-control -f deploy/ugv-zmq/site-control/compose.yaml up -d
```

三个镜像必须固定到验收的 image ID/digest；启动前检查候选及管理端口无冲突。
保留观测数据库卷 `smpp_zmq_site_observation`、原业务/命令库、账号、绑定、PMS 配置与签名密钥。

## 操作与结果

- 导航：单点、实际路点、返航；速度 m/s、避障，底盘模式/任务反馈及多帧停稳证据分别校验。
- 云台：绝对弧度、倍率、100–1000 ms 角速度租期；按请求 ID 和实际状态关联。
- 区域：四点严格凸 WGS84，经度在前，明确椭球高；环视明确扫描角度、速度、循环数。
- 仿真效果：缺省 observation 必须引用当前身份和接收会话中有效的地理观测；manual 必须说明目标标识、位置和来源。
  未知高度传 null，禁止补零。接纳、动作结束、仿真效果和迟到结果分别显示；协议不支持停止。
- 采用并导航：引用不可改写的预览 commandId；核实目录、原始响应哈希、坐标转换、五分钟预览期限及新鲜起点，
  将实际规划点提交为独立导航任务，保留原预览。
- 停止：独立提交取消，只处理本控制端已接管任务。在途任务返回 ID 后继续取消；无 ID 的未知结果需要核实，不能宣称已停止。
- 重启/断线/回执丢失：不重发已尝试的运动命令。未知终态仍保持未知；操作员凭新鲜空闲状态和处置原因按组件对账。
  底盘对账需任务非运行、两份独立零速定位及新鲜健康状态；对账只解除占用，不改变原结论。

检查结果永久区分扫描执行、覆盖声明、识别流完整性。无目标流时缺失证据明确列出；
有效空报告仅说明已收到的帧为空，不能证明全任务没有发现。内联最多 256 项，完整接收版本分页可读。
源启动身份、覆盖足迹、真实轨迹及可恢复报告历史仍受现有上游协议约束。

## 验收与回退

软件使用隔离原生 ZMQ socket、正式 JWT MCP、PostgreSQL 和浏览器验证，不能计为现场动作验收。
操作员通过候选面板逐项完成现场动作并保存 Task ID/回执/原始结果，检查动作与完整报告分别记录。
完成后才切换正式控制端口。现场缺口、未知和不完整结果单列，不计为完整成功。
回退使用经过验证的 site_readonly 1.1.0 镜像/配置；停止控制写端后再启只读服务。
数据库卷、任务、观测、结果和审计保留；旧 MQTT 写端继续停用，不自动恢复。

### 保留 PMS 地址的正式编排

`compose.yaml` 用于回环候选。正式使用 `compose.formal.yaml`，三项应用使用已验证的宿主网络。
Runtime 绑定 0.0.0.0:19100，面板绑定 0.0.0.0:19101；Provider 仅绑定 127.0.0.1:7010，
管理入口仅绑定 127.0.0.1:19108。Runtime 通过本地 hosts 保留 `adapter:7010`。

原生 ZMQ 在当前宿主网络可达，Docker 桥接路径无法接收三路发布；不能只凭 HTTP 就绪就判为接入成功。
正式使用与候选相同的宿主机数据库入口和观测库入口，保留原账号、卷和来源身份。
原 Runtime 容器更名保留后，由独立 `pms-gateway` 保留原逻辑容器名及两个既有网络。
该网关只将内部 8080 原样转发至宿主机的 Runtime 19100，不发布局域网端口，不保存凭据。
`SITE_HOST_GATEWAY_IP` 固定为已验证的原 Runtime 网桥网关。
PMS 的 direct_container 访问地址、deployment、instance、注册 URL 及注册令牌保持原值。
`SITE_PMS_API_ADDRESS` 记录原 PMS API 在 Runtime 网桥上的实际地址，Runtime 通过容器 hosts 解析原 `pms-api` 名称。
交接 CLI 始终使用旧写端不可变容器 ID，容器更名不会改变停止证明。

保留原 Runtime 的 `/run/config` 令牌目录及 `/var/lib/sdar` 轨迹签名密钥。
site_anonymous 下 SDAR Binding 固定使用 unauthenticated://none，不配置或发送 JWT。
原 direct_container 目录的可选 JWT 可继续验证，或通过正式治理改为匿名目录读取。
使用现有 PMS `file_credentials` 机制，描述符精确绑定 provider/deployment/instance；
签名密钥只挂载到私有凭据目录，不向浏览器传递。
若存在其他 external 实例，必须保留其原凭据。
面板 JWT 有效期记录在私有部署记录中；轮换时保持 authority key/tenant/subject，更新服务器文件并重启面板。

现场观测原始档案按分区计量；原默认 1 GiB 档案已满时会停止接收并报告
`ZMQ_ARCHIVE_PAYLOAD_BUDGET_EXHAUSTED`。本次正式配置为每分区 64 GiB，保留历史数据。
后续应结合磁盘容量核实 `archive_partition.canonical_bytes`，在上限前安排容量或归档。
