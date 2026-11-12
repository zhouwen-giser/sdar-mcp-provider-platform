# ZMQ 1.5.1：仅在 SMPP 对齐现场接口

本版本不修改、重启或部署仿真端，也不修改 SDAR。15 项工具保持；新增精确目录
`zmq_v1_5_1_readonly_15` / `zmq_v1_5_1_site_control_15`，Provider 版本 1.5.1。
旧 1.5.0 及其原始南向 2.1 合同保持冻结。

## 显式底盘接收合同

部署文件使用 `ugv.zmq-site-deployment/3`：

- `publicationFraming=prefix_business_length_crc`：线路前四字节为业务长度；头部长度等于业务长度，CRC 仅覆盖业务字节。严格校验前缀、实际长度、CRC、消息类型与设备身份。
- `publicationFraming=prefix_wire_length_crc`：严格标准 2.1。
- `commandFraming=prefix_wire_length_crc`：命令保持严格 2.1；不能根据接收格式推断或自动切换发送格式。

没有自动探测或失败回退。现场兼容接收在观测中标记 `2.1-site-rx/1`，原始报文与校验结果按新配置身份归档；不把它报告成标准 2.1 已符合。
合同、现场四类样本及原始 2.1 的继承哈希由 `scripts/ugv-zmq/interop-contract.ts` 检查。

## 7879 Dashboard V2

设置 `plannerFrame=scene_enu_wgs84_v1`，在 profile.planner 固定 `entityId`、`entityType`、`systemId`、`mapReference`。
每次调用使用同一 Socket.IO 连接的新鲜 `state.mission_context`，核对设备/控制器/epoch，并冻结任务身份。
只发送 `plan_route`，带唯一 `planning_request_id` 和 Socket.IO ACK 标识；不发送登记路线、START、STOP 或任何运动指令。

地图和场景通过现有只读 API 核实：

- GET `/api/simulation/scenarios`：ready、真实场景、地图和 epoch。
- GET `/api/simulation/map/assets`：实际地图 ID。
- GET `/api/simulation/map/gnss`：原点及东西/南北轴样本，核对 WGS84/ECEF/ENU 转换。

输入输出仍为 WGS84 经度、纬度；线路规划使用 map 的东/北米制坐标。二维路线的参考平面高度不标记为实测高度。
请求起点只用于核验，上游实际使用车辆实时位置。起点变化、任务/控制器/epoch 变化、地图不符和明确 ACK 拒绝分别报告；不重复请求或补造身份。
结果为 `ugv.zmq-route-preview/2`，记录上下文、请求 ID、源响应哈希与转换参考，保持 `preview_only`。

2026-11-12 只读核实的现场为 `yuan_qu`：原点纬度 22.506858333333、经度 114.048222222222、参考椭球高 500m。
这来自现场读取及参考配置；后续切换场景必须更新显式部署配置。此前机场/重庆坐标不能用于该园区规划。

## 验证与部署

仅使用隔离数据库和本地模拟器进行控制回归。现场验收只读订阅、精确取帧及路线预览；真实控制继续使用操作员确认。
先更新候选 19110/19111，保留数据库卷、账号、原始归档和接收会话边界。
替换镜像后重新开始 24 小时验证，旧运行仅保留为已撤换证据。
使用 `scripts/ugv-zmq/v151-stability.py`，配置包含明确的 `publicationFraming` 及来自已核实道路的 `plannerProbe.waypoints`。
每分钟检查实际容器/镜像/重启、归档、15 项目录身份、兼容合同和新鲜定位；每十分钟执行一次独立只读规划及精确原图读取。
摘要分别记录运行稳定性和现场只读专项资格，规划拒绝或来源缺失不能被解释成专项通过。工具白名单不包含设备控制或生命周期操作。
正式切换仍要求工程门禁、现场两项专项验收、实际 24 小时无重启/OOM，以及任务空闲和写端交接。

回退使用显式接收变体配置匹配现场的只读镜像；原始严格 2.1 镜像不能把当前非标准报文当作有效底盘状态。
