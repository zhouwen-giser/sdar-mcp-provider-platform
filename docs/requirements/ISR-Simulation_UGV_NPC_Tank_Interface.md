# ISR-Simulation 仿真系统可上报数据报告（UGV / NPC Tank）

> **用途**：供**分析模块**对接仿真系统上报数据使用。
> **覆盖实体**：仅 `ugv`(无人车，红方) 与 `npc_tank1`(NPC 坦克，蓝方)。
> **组织方式**：每个实体的上报/控制按 **底盘(chassis)** 与 **载荷(payload)** 两层分开；每层再分 **上行(上报)** 与 **下行(控制)**。底盘/载荷之外的裁判/对抗态与全局态势单列（见 §5）。


---

## 0. 数据通道总览

| 通道 | 协议/传输 | 服务地址（默认） | 方向 | 用途 |
|------|-----------|------------------|------|------|
| **MCP Server** | streamable-http `/mcp` | UGV `:19000` / NPC Tank `:19003` | 双向（工具调用） | LLM/Agent 查询状态、获取目标、下达底盘/载荷控制 |
| **MQTT Bridge** | MQTT | broker `192.168.2.63:1883`；Redis `192.168.1.7:6379` | ROS2→MQTT 上报为主 | 遥测、态势、图像 base64、战斗事件出站 |
| **视频推流** | RTP(H.264-UDP) + WebRTC | RTP → `192.168.200.19:5004/5006`；WebRTC `:9080` | 出站 | 前视(底盘)/光电(载荷)相机实时视频 |

> MQTT broker / Redis / RTP 目的 IP 均在配置文件中，部署时按现场网络改；本表为仓库当前默认值。


## 2. 分层原则：底盘 / 载荷 / 裁判-全局

| 层 | 覆盖内容 | 上行（上报）分类 | 下行（控制）分类 |
|----|----------|------------------|------------------|
| **底盘 chassis** | 平台机动、能源、定位、自检 | ① 基础遥测(定位/姿态/速度) ② 自检 ③ 续航·电量 ④ 任务状态 ⑤ 错误码 | ① 任务 ② 控制 |
| **载荷 payload** | 光电/云台、探测目标、区域侦察、火控 | ① 载荷(在线/云台/激光/瞄准) ② 目标 ③ 错误码 ④ 任务状态 | ① 任务 ② 控制 |
| **裁判/全局**（§5） | 对抗裁决与全局态势 | HP/弹药/存活、事件、障碍、异常 | 异常注入等 |

**四条贯穿全局的约定**：
1. **对外用 MQTT，不直接暴露 ROS2**：本报告表格里的主题名均为 **MQTT 主题**（分析模块订阅端）。MQTT 主题名默认与内部 ROS2 话题同名（聚合状态 `status/{id}` 例外），编码默认 `json`、`qos=1`；ROS2 仅系统内部使用。**只有经桥接的主题才在 MQTT 可见**——载荷的瞄准/激光/视场、区域侦察态/目标/异常、云台等**不桥接 MQTT**，经 **MCP（§6）** 获取；相机视频经 **RTP/WebRTC（§8）**。来源 `ros2_mqtt_bridge/config/bridge_config.yaml`。
2. **任务 state 数值编码**（底盘任务态与载荷任务态共用）：`-1` 空闲 / `0` 就绪 / `1` 进行中 / `2` 暂停 / `3` 已取消 / `4` 已完成 / `5` 已失败。
3. **错误码是两套、互不相同**：底盘错误码 = `AutoSystemState.err_list`（9 码，源 `anomaly_types.ERR_CODE`，见 §7.3）；载荷错误码 = 区域侦察异常上报（MCP `get_exceptions`，光电/载荷自身异常）。切勿混用编码。
4. **部件健康跨层**：`EntityHealth`(§7.4) 是**单一 MQTT 主题**但 10 部件横跨两层（`weapon/sensor` 属载荷，`power_battery/motor/gnss/comms/navigation` 属底盘）。本报告整体归入**底盘自检**，载荷相关部件在其中体现。

> **真实设备接口对照标记**（2026-07-21 核对）：以下各表中，凡数据项在真实设备接口文档 **zz.md（自主机动/指控）** 与 **zh.md（智能载荷/侦察）** 中**均无对应**的，在该行「说明」末尾标 **〔❌ zz/zh 均无〕**；仅部分子字段缺失的标 **〔⚠️ 部分〕**。未标注者即可在 zz 或 zh 找到对应消息/字段（消息存在即算"查得到"，即便 zz 按 §1.2 未展开字段）。本次仅覆盖**上报数据**（§3.1.1 / §3.2.1 / §4.1.1 / §4.2.1）、全局态势（§5）、数据结构（§7）、视频（§8）；下行控制与 MCP 工具（§3.x.2、§4.x.2、§6）为**指令非数据**，未纳入本次标注。

---

## 3. UGV 数据接口（role=`ugv`）

来源：`actor_spawn/.../ugv/spawn_vehicle.py`、`camera/spawn_ugv_front_camera.py`、`camera/spawn_gimbal_camera.py`、`actor_control/.../vehicle_state_node.py`、`gimbal_control/area_recon_scan.py`。

### 3.1 底盘（chassis）

#### 3.1.1 上行（上报，MQTT）

| 分类 | MQTT 主题 | 消息类型 | 说明 |
|------|-----------|----------|------|
| ① 基础遥测·定位 | `/ugv/gnss` | sensor_msgs/NavSatFix | WGS84 经纬高（写 Redis `device-ugv1:location`，仅 lat/lon） |
| ① 基础遥测·惯导 | `/ugv/imu` | isr_ros2_msgs/PolarAngle | yaw/pitch/roll |
| ① 基础遥测·速度 | `/ugv/speed` | std_msgs/Float64 | km/h |
| ① 基础遥测·综合 | `/ugv/status` | std_msgs/String(JSON) | ★ CARLA 原始+仿真派生合并 JSON（含控制/能源/温度/行驶/惯导/网络/任务轨道，详见 §7.1） |
| ② 自检 | `/ugv/system_state` | isr_ros2_msgs/AutoSystemState | 运行态/模式/限速/视频配置/错误码列表（详见 §7.3） |
| ② 自检·部件健康 | `/ugv/component_status` | isr_ros2_msgs/EntityHealth | 10 部件各 0(正常)/1(异常)，2Hz（跨底盘/载荷，详见 §7.4）〔❌ zz/zh 均无：真实设备只到聚合故障列表(zz)/设备异常(zh)，无逐部件 0/1 健康〕 |
| ③ 续航·电量 | `/ugv/battery_range_km` | std_msgs/Float32 | 剩余里程 km（电量/油量 SOC 在 §7.1 综合状态 JSON 的能源段） |
| ④ 任务状态 | `/ugv/mission_state` | isr_ros2_msgs/MissionState | 底盘机动任务态 |
| ④ 任务状态·导航 | `/ugv/nav_state` | isr_ros2_msgs/NavState | 位置/速度/续航（`distance_remaining` 剩余航程因 zz/zh 均无已删除） |
| ⑤ 错误码 | （在 `/ugv/system_state` 的 `err_list`） | int32[] | 底盘错误码，9 码表见 §7.3 |

#### 3.1.2 下行（控制，MCP）

> **底盘下行控制统一走 MCP，不再桥接 MQTT。** MCP server 直接向 ROS2 控制话题（`/ugv/path_follow_mission`、`/ugv/return_home_mission`、`/ugv/mission_cancel_cmd`、`/ugv/motion_pause`、`/ugv/stop_cmd` 等）发布，原 `mqtt_to_ros` 桥接项已删除。

| 分类 | 通道 | 工具 | 说明 |
|------|------|------|------|
| ① 任务 | MCP | `ugv_path_follow_mission`（航点列表/URL） | 路径跟随；单点即目标点机动 |
| ① 任务 | MCP | `ugv_return_home` | 返航（逆序重下发上次路径） |
| ① 任务 | MCP | `ugv_move_distance` | 沿指定方向定距移动 |
| ② 控制 | MCP | `ugv_mission_control`(start/pause/terminate/cancel/stop) | 底盘任务生命周期：开始/暂停/取消/停止 |
| ② 控制 | MCP | `ugv_stop` | 紧急停止（等价 `mission_control(stop)`） |

> 遥控/键控底盘（原 `/ugv/remote_control`、`control/ugv1`）无 MCP 等价工具，随下行 MQTT 一并移除。

### 3.2 载荷（payload）

光电吊舱相机 960×540、基准 fov、≈30fps，支持变焦；区域侦察由 `area_recon_scan` 驱动。**载荷数据大多不桥接 MQTT**：目标类经 MQTT，其余（在线/云台/激光/瞄准/侦察态/异常、动作控制）经 **MCP（§6.3）**，相机视频经 **RTP/WebRTC（§8）**。

#### 3.2.1 上行（上报）

| 分类 | 通道 | 主题 / 工具 | 说明 |
|------|------|-------------|------|
| ② 目标·检测数组 | **MQTT** | `/ugv/detected_objects` | 相机检测目标（DetectedObjectArray） |
| ② 目标·文本 | **MQTT** | `/ugv/target_detected` | 检测提示（String） |
| ② 目标·定位 | **MQTT** | `/ugv/target/gnss` | 锁定目标 GNSS（NavSatFix） |
| ② 目标·截图 | **MQTT** | `/ugv/target/base64` | 目标 JPEG base64（String）〔❌ zz/zh 均无：图像内容；zz §1.2 排除视频/图像链路，zh 仅有 pixel_pos 边框无图像〕 |
| ① 载荷·在线/云台/激光/瞄准 | MCP | `ugv_area_recon_get_status` / `ugv_laser_range` | `load_status/online` + `gimbal{yaw,pitch,zoom}`、激光测距、瞄准误差（**不经 MQTT**）〔⚠️ 部分：load_status/online、激光测距 distance 可对 zh；gimbal 原始角与瞄准误差 zh 动作级接口不暴露，均无〕 |
| ③ 错误码 | MCP | `ugv_area_recon_get_exceptions` | 载荷/区域侦察异常（**独立于底盘错误码**） |
| ④ 任务状态 | MCP | `ugv_area_recon_get_status` | 侦察动作态 `status/scan_num/progress` + `lock` + `attack_ready`；亦见 §7.1 综合状态 JSON 的 `eo_task/weapon_task` |
| 视频·光电 | RTP/WebRTC | `/eo/camera/image_raw`（→RTP 5006） | 光电吊舱原始（§8）〔❌ zz/zh 均无：zz §1.2 排除视频链路，zh 无视频〕 |
| 视频·叠加 | RTP/WebRTC | `/ugv/camera/image_detect` | 画框后图像（§8）〔❌ zz/zh 均无：同上〕 |

> 底盘行车相机 `/ugv/front_camera/image_raw`（→RTP 5004）属**底盘**，不在载荷内。

#### 3.2.2 下行（控制）

| 分类 | 通道 | 主题 / 工具 | 说明 |
|------|------|-------------|------|
| ① 任务·打击 | MCP | `ugv_attack_target`（发布 `/ugv/attack/cmd`） | 打击指令下发 |
| ① 任务·侦察配置 | MCP | `ugv_area_recon_configure` | 配置侦察区域 |
| ① 任务·锁定 | MCP | `ugv_area_recon_lock` / `unlock` | 锁定/解锁（需扫描运行中） |
| ① 任务·云台 | MCP | `ugv_gimbal_move`(absolute/relative/velocity/reset) | 云台指向 |
| ① 任务·打击确认 | MCP | `ugv_attack_target` + `ugv_area_recon_attack_confirm` | lock→confirm 闭环 |
| ② 控制 | MCP | `ugv_area_recon_control`(1启动/2暂停/3继续/4停止) / `ugv_area_recon_reset` | 侦察动作生命周期/复位 |

---

## 4. NPC Tank 数据接口（role=`npc_tank1`）

来源：`actor_spawn/.../npc_tank/spawn_npc_tank.py`；区域侦察复用 UGV 的 `area_recon_scan`（坦克专属实例，见 `npc_tank_control.launch.py`）。**结构与 UGV 对齐**，差异已在下方标注。

**与 UGV 的差异**（2026-07-21 已将下列接口对齐 UGV）：IMU 现为 `isr_ros2_msgs/PolarAngle`（与 UGV 一致，原 `sensor_msgs/Imu` 已改）；底盘任务态现为 `/npc_tank1/mission_state`(MissionState) + `/npc_tank1/nav_state`(NavState)，与 UGV 同构（原 `maneuver_state`/`move_state`/`move_status`/`nav_status` 已不再对外，仅 `maneuver_state`、`nav_status`、`move_status` 作**内部 ROS 话题**保留供任务/大屏消费）；`run_state`/`mode` 现按真实任务态填（原恒 0）。**仍保留的结构性差异**（不对齐）：MCP 端口 `19003`；无独立前视相机，光电相机即 `/npc_tank1/camera/image_raw`（960×540, fov=30）；载荷多**周扫**（eo_scan）与变焦。

### 4.1 底盘（chassis）

#### 4.1.1 上行（上报，MQTT）

| 分类 | MQTT 主题 | 消息类型 | 说明 |
|------|-----------|----------|------|
| ① 基础遥测·定位 | `/npc_tank1/gnss` | sensor_msgs/NavSatFix | WGS84 |
| ① 基础遥测·惯导 | `/npc_tank1/imu` | isr_ros2_msgs/PolarAngle | yaw/pitch/roll（已与 UGV 对齐，原为 sensor_msgs/Imu） |
| ① 基础遥测·速度 | `/npc_tank1/speed` | std_msgs/Float64 | km/h |
| ① 基础遥测·综合 | `/npc_tank1/status` | std_msgs/String(JSON) | 与 `/ugv/status` 同构（§7.1） |
| ② 自检 | `/npc_tank1/system_state` | isr_ros2_msgs/AutoSystemState | 同 §7.3 |
| ② 自检·部件健康 | `/npc_tank1/component_status` | isr_ros2_msgs/EntityHealth | 2Hz，10 部件（§7.4）〔❌ zz/zh 均无：真实设备只到聚合故障列表(zz)/设备异常(zh)，无逐部件 0/1 健康〕 |
| ③ 续航·电量 | `/npc_tank1/battery_range_km` | std_msgs/Float32 | 剩余里程 km |
| ④ 任务状态 | `/npc_tank1/mission_state` | isr_ros2_msgs/MissionState | 底盘机动任务态（**已对齐 UGV**；原 `maneuver_state`/`move_state`） |
| ④ 任务状态·导航 | `/npc_tank1/nav_state` | isr_ros2_msgs/NavState | 位置/速度/续航（**已对齐 UGV**；由 action client 从内部 `nav_status`+`battery_range_km` 重组） |
| ⑤ 错误码 | （在 `/npc_tank1/system_state` 的 `err_list`） | int32[] | 底盘错误码（§7.3） |

> 内部 ROS 话题（**不桥接 MQTT**）：`/npc_tank1/maneuver_state`（供 `publish_tank_waypoints` 判巡逻完成）、`/npc_tank1/nav_status`(TwistStamped)、`/npc_tank1/move_status`(Int32)（供 dashboard 消费）。

#### 4.1.2 下行（控制）

| 分类 | 通道 | 主题 / 工具 | 说明 |
|------|------|-------------|------|
| ① 任务·航点 | MCP | `npc_tank_send_waypoints`（发布 `/npc_tank1/waypoints`） | 航点注入 |
| ① 任务·路径/定距/返航 | MCP | `npc_tank_path_follow_mission` / `npc_tank_send_waypoints` / `npc_tank_move_distance` / `npc_tank_return_home` | 下发底盘机动 |
| ② 控制·停止 | MCP | `npc_tank_stop`（发布 `/npc_tank1/stop_cmd`） | 停止 |
| ② 控制·取消 | MCP | `npc_tank_cancel_mission`（发布 `/npc_tank1/mission_cancel`；`cancel_move` 折叠进此） | 取消/取消移动 |
| ② 控制·任务生命周期 | MCP | `npc_tank_mission_control` | 启停/暂停/终止 |

### 4.2 载荷（payload）

同 UGV：**目标类经 MQTT，其余经 MCP，视频经 RTP/WebRTC**。

#### 4.2.1 上行（上报）

| 分类 | 通道 | 主题 / 工具 | 说明 |
|------|------|-------------|------|
| ② 目标·检测数组 | **MQTT** | `/npc_tank1/detected_objects` | DetectedObjectArray |
| ② 目标·文本 | **MQTT** | `/npc_tank1/target_detected` | String |
| ② 目标·定位 | **MQTT** | `/npc_tank1/target/gnss` | NavSatFix |
| ② 目标·截图 | **MQTT** | `/npc_tank1/target/base64` | JPEG base64〔❌ zz/zh 均无：图像内容；zz §1.2 排除视频/图像链路，zh 仅 pixel_pos 无图像〕 |
| ② 目标·侦察列表 | MCP | `npc_tank_area_recon_get_targets` | 区域侦察目标（**不桥接 MQTT**） |
| ① 载荷·在线/云台/激光 | MCP | `npc_tank_area_recon_get_status` / `npc_tank_laser_range` | `load_status/online` + `gimbal{yaw,pitch,zoom}`、激光〔⚠️ 部分：load_status/online、激光 distance 可对 zh；gimbal 原始角 zh 不暴露〕 |
| ③ 错误码 | MCP | 区域侦察异常上报 | 载荷异常（**独立于底盘错误码**） |
| ④ 任务状态 | MCP | `npc_tank_area_recon_get_status` | 侦察动作态 + 锁定/attack_ready |
| 视频·光电 | RTP/WebRTC | `/npc_tank1/camera/image_raw` | 960×540, fov=30（默认未在 RTP 列表，§8）〔❌ zz/zh 均无：zz §1.2 排除视频链路，zh 无视频〕 |
| 视频·叠加 | RTP/WebRTC | `/npc_tank1/camera/image_detect` | 画框后图像〔❌ zz/zh 均无：同上〕 |

#### 4.2.2 下行（控制）

| 分类 | 通道 | 主题 / 工具 | 说明 |
|------|------|-------------|------|
| ① 任务·打击 | MCP | `npc_tank_attack_target`（发布 `/npc_tank1/attack/cmd`） | 打击指令 |
| ① 任务·周扫/变焦 | MCP | `npc_tank_eo_scan_start`/`stop` / `eo_set_angle`（发布 `/npc_tank1/eo/cmd`） | 光电周扫/变焦 |
| ① 任务·侦察/云台 | MCP | `npc_tank_area_recon_configure` / `lock` / `unlock` / `gimbal_move` / `eo_scan_start`/`stop` / `eo_set_angle` | 配置/锁定/云台/周扫 |
| ① 任务·打击确认 | MCP | `npc_tank_attack_target` + `npc_tank_area_recon_attack_confirm` | 打击闭环 |
| ② 控制 | MCP | `npc_tank_area_recon_control`(1启动/2暂停/3继续/4停止) / `npc_tank_area_recon_reset` | 侦察动作生命周期/复位 |

---

## 5. 裁判 / 对抗态 与 全局态势（底盘/载荷之外）

### 5.1 各实体裁判状态

| MQTT 主题 | 消息类型 | 说明 |
|-----------|----------|------|
| `/ugv/referee/status`、`/npc_tank1/referee/status` | isr_ros2_msgs/EntityStatus | HP/弹药/存活/姿态/属性（详见 §7.2）〔❌ zz/zh 均无：HP/弹药/存活等对抗态是仿真裁判专有；zh 仅对"目标"有 damage/iff，非本车战斗状态〕 |

### 5.2 全局（非按实体）MQTT 主题

来源：`referee/`、`anomaly_management/`。

> **❌ 本节全部 zz/zh 均无**：CARLA 真值位姿、攻击裁决事件、销毁指令、障碍/可见性、异常管理/通信丢失区、MCP 任务广播——均为仿真裁判/全局态势，真实设备接口 zz.md、zh.md 中都没有对应消息。（逐行不再重复标注。）

| MQTT 主题 | 消息类型 | 频率 | 说明 |
|-----------|----------|------|------|
| `/entity/state` | EntityState | **10Hz** | 所有实体 CARLA 真值位姿 |
| `/referee/event` | RefereeEvent | 事件触发 | 攻击事件 hit/miss/destroy |
| `/referee/destroy_cmd` | DestroyCommand | 事件触发 | 实体销毁指令 |
| `/referee/visible_obstacles` | VisibleObstaclesArray | — | 各实体当前可见障碍 |
| `/world/obstacles` | RoadObstacleArray | latched | 全场障碍区快照（禁行区） |
| `/sim/anomaly_state` | std_msgs/String(JSON) | — | 异常管理状态 |
| `/sim/comm_loss_zones` | RoadObstacleArray | — | 通信丢失区域 |
| `/mcp/task_status` | std_msgs/String(JSON) | 1Hz | MCP 各 actor 各轨道任务状态广播 |
| `/sim/anomaly_cmd`（下行） | — | — | 注入异常 |

---

## 6. MCP 工具接口（按底盘/载荷分）

MCP Server 以 **streamable-http** 暴露，端点 `http://<host>:<port>/mcp`；分析模块可**主动拉取**状态与目标。来源：`ros2_mcp_server/`。

### 6.1 Server 与端口

| Server | 端口 | 文件 | Agent 可见工具数 |
|--------|------|------|------------------|
| UGV | 19000 | ugv_mcp_server.py | 14 |
| NPC Tank | 19003 | npc_tank_mcp_server.py | 14 |

> 云台控制已并入各实体 MCP（`ugv_gimbal_move` / `npc_tank_gimbal_move`），无独立 Gimbal Server。

### 6.2 工具清单（见 §3 / §4，此处不重复）

各 MCP 工具已在 **§3.1.2 / §3.2.1 / §3.2.2**（UGV）与 **§4.1.2 / §4.2.1 / §4.2.2**（NPC Tank）里按**底盘/载荷**分列。两实体注册工具 **1:1 同构**（各 14 个：车控 6 + 区域侦察 7 + 光电 1），仅前缀 `ugv_` / `npc_tank_` 不同；坦克光电 `npc_tank_gimbal_move` 额外分派周扫 `eo_scan_start`/`stop`、`eo_set_angle`。

**打击返回 `result` 枚举**：`success/destroyed/miss/out_of_range/out_of_fov/no_ammo/cooldown/weapon_fault/friendly_fire/dead/not_registered/anomaly/timeout/unknown`。

> 工具收敛方案见 `doc/architecture/2026-07-07-ugv-mcp-final-13-tool-plan.md`（该方案 13 项，另加 `get_capabilities` 共 **14** 项注册）。

---

## 7. 关键上报数据结构详解

### 7.1 综合状态 JSON `/ugv/status`、`/npc_tank1/status`

由 `vehicle_state_node`（1Hz）发布，String(JSON)，合并 CARLA 原始 + 仿真派生。**跨底盘/载荷**：能源/温度/行驶/惯导/网络属底盘，`eo_task/weapon_task` 属载荷。

```
vehicle_id, role_name, entity_id
position {x, y, z}, speed_kmh                       # 底盘·基础遥测
control {throttle, steer, brake, reverse}          # 底盘
能源: lvbattery_soc, hvbattery1_soc, hvbattery2_soc, fuel1, fuel2   # 底盘·电量
温度: motor_temp, engine_water_temp                 # 底盘
行驶: ready_status, gear_status, veh_speed, brake_status, emergency_stop_status   # 底盘
惯导: heading, roll, pitch, ins_init, gnss, location_status         # 底盘·定位
模式/网络: power_supply_status, operate_mode_status, fault,
          ping_status, packet_loss_rate, average_round_trip_time     # 底盘·自检
任务轨道: chassis_task(底盘), eo_task(载荷), weapon_task(载荷) —— 各含 {id, type, state, progress}
```
车辆未就绪时返回 `{"available": false}`。

### 7.2 自定义消息字段（isr_ros2_msgs）

| 消息 | 字段 | 说明 |
|------|------|------|
| **EntityState** | `entity_id, entity_type, pose[3], yaw, camera_yaw` | CARLA 真值位姿。`pose[3]`=世界坐标 x/y/z；`yaw`=车体朝向；`camera_yaw`=EO 相机世界 yaw（弧度，用于 FOV 指向）〔❌ zz/zh 均无：全实体 CARLA 真值广播是仿真专有〕 |
| **EntityStatus** | `entity_id, type, hp, ammo, alive, pose[3], camp, chassis_yaw, gimbal_yaw` + 属性 `max_hp, damage, hit_range, hit_rate, detection_range, fov, cooldown` | 裁判发布的实体战斗状态。`chassis_yaw`=底盘朝向、`gimbal_yaw`=光电世界系绝对角（弧度）；属性段来自 `entities.yaml`（§1）〔❌ zz/zh 均无：HP/弹药/存活/命中率等对抗态是仿真裁判专有〕 |
| **RefereeEvent** | `event_type, attacker, target, success, damage, remaining_hp` | 攻击裁决事件（hit/miss/destroy）〔❌ zz/zh 均无：攻击裁决是仿真专有〕 |
| **DestroyCommand** | `command, entity_id, entity_type` | 实体销毁指令〔❌ zz/zh 均无〕 |
| **EntityHealth** | `header, entity_id` + 10 部件(uint8，0=正常/1=异常)：`power_battery, lvbattery, fuel, water_temp, motor, sensor, gnss, comms, weapon, navigation` | 分项部件健康，2Hz。详见 §7.4〔❌ zz/zh 均无：无逐部件 0/1 健康，zz 只到故障列表、zh 只到设备异常〕 |
| **AutoSystemState** | `header, entity_id, run_state, mode, speed_limit, video_config(VideoProperty), err_list[]` | 系统自检。详见 §7.3 |
| **MissionState** | `header, entity_id, id, type, state, progress` | 任务态。`type`=1单航点/2多航点/4返航；`state`=-1..5（§2）；`progress`=[0,100] |
| **NavState** | `header, entity_id, position_x/y/z, speed_kmh, battery_range_km` | 导航态（UGV）。（`distance_remaining` 剩余航程因 zz/zh 均无已删除，zz §8.3 缺口） |
| **DetectedObject** | `header, object_type, id, x, y, z` | 单个检测目标。`id`=CARLA actor id（打击按此锁定），`x/y/z`=世界坐标 |
| **DetectedObjectArray** | `header, objects[]` | 检测目标数组 |
| **PolarAngle** | `yaw, pitch, roll` | 姿态角（弧度），UGV IMU 上报 |
| **AttackCommand** | `attacker, target` | 打击指令 |
| **RoadObstacle** | `id, shape, kind, center_x/y, radius, vertices[], height, latitude, longitude` | 障碍区。`shape`=0圆/1矩/2多边；`kind`=0正障碍/1负障碍〔❌ zz/zh 均无：禁行区/障碍快照是仿真专有（zz 仅有道路结构线/动态避障开关，非障碍区数据）〕 |
| **VisibleObstaclesArray / EntityVisibleObstacles** | `entities[]` → `entity_id, entity_type, obstacles[](GeoObstacle)` | 各 actor 可见障碍；`GeoObstacle` 纯经纬度，不含 CARLA x/y〔❌ zz/zh 均无〕 |

### 7.3 系统自检 `AutoSystemState`（`/{id}/system_state`，底盘·自检+错误码）

**发布者与频率**：UGV 的 `vehicle_action_client`、坦克的 `npc_tank_control_action_client` 以 **1Hz** 发布。字段：`header, entity_id, run_state, mode, speed_limit, video_config, err_list[]`。

#### ① `run_state`（int32）—— 运行态
| 值 | 含义 |
|----|------|
| **0** | 异常 / 非运行（空闲、暂停、已完成、故障） |
| **1** | 正常运行（自主任务执行中） |

- **UGV**：`run_state = 1 当且仅当 mission_state==1`，否则 0。
- **NPC Tank**：当前恒发 `run_state=0`（占位，未接实时诊断），判断"是否在跑"应改用 `MissionState.state`。

#### ② `mode`（int32）—— 自主模式
`0` 空闲 / `1` 路径跟随 / `2` 目标跟踪 / `3` 目标点 / `4` 返航 / `5` 巡逻 / `6` 轨迹跟随(废弃) / `7` 编队。
- **UGV**：`mode = 1 当 mission_state != -1`，否则 0（仅区分空闲/非空闲）。
- **NPC Tank**：当前恒发 `mode=0`。
- **聚合状态映射**（§9.2）：`{0→manual, 1/2→autonomous}`。

#### ③ `speed_limit`（float64）
限速，单位 km/h；默认 `100.0`。

#### ④ `video_config`（VideoProperty）
| 字段 | 含义 / 取值 |
|------|-------------|
| `video_enable` | 0=关闭，1=打开 |
| `video_option` | 视频切换：0-周视/1-遥控后退R/3-遥控前进D/16-前主/17-后主/18~21-四角侧/22-环视/23~24-左右中/25~28-四向周视 |
| `steam_set`(streams_set) | 码流（暂不支持）：0默认/1=2M/2=4M |
| `resolution_set` | 分辨率（暂不支持，默认720P）：0默认/1=1080p/2=720p |
| `video_source` | 光源（暂不支持，默认白光）：0白光/1红外/2融合 |

> 仿真中发布默认 `VideoProperty()`（全 0），真实视频参数以 §8 推流为准。

#### ⑤ `err_list`（int32[]）—— 底盘错误码
正常为空；异常时填码。源 `anomaly_types.ERR_CODE`（与部件健康、故障位掩码同源）：

> 〔❌ zz/zh 均无：这 9 码为仿真专有。zz.md 只到"故障列表"承载消息 `MSG_ADT_SYS_STATUS`（不展开码，源码索引指向 `error_code.h`）；zh.md 只有 `MotionException`/`EquipmentException.error_code`（清单里为占位 `0x...`），且属**载荷错误域**，与本表**底盘** 9 码是两套。〕

| 码 | 异常 | 中文 | 影响 |
|----|------|------|------|
| 1 | path_blocked | 道路阻断 | 驻车、任务停止 |
| 2 | gnss_lost | GNSS 丢失 | 定位失效 |
| 3 | weapon_jammed | 武器异常 | 火控自检失败 |
| 4 | eo_no_aim | 光电/云台异常 | 无法瞄准 |
| 5 | power_depleted | 电量/油量耗尽 | 续航置 0、停止 |
| 6 | net_lost | 通信丢失 | 不接收任务/不回传 |
| 7 | sensor_blind | 传感器致盲 | 感知回传中断 |
| 8 | mobility_damage | 机动损伤 | 过温、停车 |
| 9 | nav_stuck | 规划卡死 | 急停 |

- UGV：前方阻断 → `err_list=[1]`（`mission_state=3`）；GNSS 丢失 → `err_list=[2]`（`mission_state=5`）；复位清空。
- 同编号合成 `0x50C0` 故障位掩码 `FAULT_BIT = 1<<(code-1)`（综合状态 JSON 的 `fault`）。
- **注意**：这是**底盘错误码**；载荷错误码走区域侦察异常上报（`*_area_recon_get_exceptions`），编码不同。

### 7.4 部件健康 `EntityHealth`（`/{id}/component_status`，跨底盘/载荷）

> **❌ zz/zh 均无**：逐部件 0/1 健康是仿真专有。真实设备 zz.md 只到聚合"故障列表"（`MSG_ADT_SYS_STATUS`，且不展开），zh.md 只到"设备异常上报"（`MarEquipmentExceptionMsg`），都没有本节这种 10 部件分项健康位。

**发布者与频率**：`anomaly_management/entity_health_node`，每实体一节点，默认 **2Hz**。**取值**：每部件 `uint8`，`0=正常/1=异常`，由**当前激活异常**经 `COMPONENT_EFFECT` 映射、再按 `COMPONENTS_BY_TYPE` 屏蔽本实体不具备的部件（恒 0）。

| # | 字段 | 中文含义 | 层 | 触发异常 |
|---|------|----------|----|----------|
| 1 | `power_battery` | 动力(高压)电池 | 底盘 | power_depleted |
| 2 | `lvbattery` | 低压电池 | 底盘 | power_depleted |
| 3 | `fuel` | 燃油 | 底盘 | power_depleted |
| 4 | `water_temp` | 发动机水温/冷却 | 底盘 | mobility_damage |
| 5 | `motor` | 驱动/机动 | 底盘 | mobility_damage |
| 6 | `sensor` | 传感器(摄像头/光电/云台) | **载荷** | sensor_blind / eo_no_aim |
| 7 | `gnss` | 卫星定位 | 底盘 | gnss_lost |
| 8 | `comms` | 通信链路 | 底盘 | net_lost |
| 9 | `weapon` | 武器/火控 | **载荷** | weapon_jammed |
| 10 | `navigation` | 导航/路径规划 | 底盘 | path_blocked / nav_stuck |

**按实体类型屏蔽**：`ugv` / `tank`(`npc_tank1`) 具备全部 10 个（纯电实体才屏蔽 `fuel`/`water_temp`，本报告两实体均不屏蔽）。若 `AnomalyClient` 不可用则降级——全部恒 0。

---

## 8. 视频 / 图像推流链路

> **❌ 本节全部 zz/zh 均无**：zz.md §1.2 明确声明**不涉及视频链路**，zh.md 也无任何视频/图像内容（仅有目标像素框 `pixel_pos`）。相机原始流、叠加图、目标截图 base64 均为仿真侧能力，真实设备接口文档中查不到。

来源：`image2video/`、根目录 `*.sdp`、`streams.yaml`。RTP + WebRTC 双模并存。

### 8.1 RTP 推流（H.264 over UDP）

| 源相机（内部话题→RTP） | 归属 | RTP 端口 | 分辨率/FOV |
|--------------|------|----------|------------|
| `/ugv/front_camera/image_raw` | UGV **底盘**前视 | **5004** | 可配 |
| `/eo/camera/image_raw` | UGV **载荷**光电 | **5006** | 960×540 |
| `/npc_tank1/camera/image_raw` | Tank **载荷**光电 | （默认未在 RTP 列表，可自行添加） | 960×540, fov30 |

- RTP 在 `streams.yaml` 的 `rtp_streams` 中，**默认 `enabled: false`**，码率 `b=AS:4000`(4Mbps)。

### 8.2 WebRTC 推流

服务端口 **9080**；`h264_nvenc`，960×540，4Mbps，20fps，超低延迟。所有 `Image`/`CompressedImage` 话题自动发现，最多 9 路网格。延迟：WebRTC ~100ms，RTP ~50ms。

### 8.3 检测结果图像

- **叠加图** `/{id}/camera/image_detect`；**目标截图** `/{id}/target/base64`（JPEG→base64，~10Hz，经 MQTT 出站，可直接取图免接视频流）。

---

## 9. MQTT 约定 / 聚合状态

### 9.1 MQTT 通用约定

- **主题名**：默认与内部 ROS2 话题同名（聚合状态 `status/{id}` 例外）。各主题已在 §3–§5 逐条列出。
- **编码/QoS**：默认 `encoding=json`、`qos=1`；`/{id}/speed` 为 `qos=0`。图像 base64（`/{id}/target/base64`）为 `json/qos1`。
- **Redis**：定位类（`/{id}/gnss`、`/{id}/target/gnss`）额外写 Redis key `device-{id}:location`（仅存 lat/lon）。
- **broker**：`192.168.2.63:1883`；Redis `192.168.1.7:6379`。

### 9.2 聚合状态（大屏首选）

`StatusAggregator` 合并为单条精简 JSON 发到 `status/{device}`：

| MQTT 主题 | 输出字段 |
|-----------|----------|
| `status/ugv1` / `status/npc_tank1` | `device_id, mode(manual/autonomous), status(idle/moving/stopped/error), speed, position{lon,lat}, remainder_range` |

- `mode` 由 `system_state.mode` 映射 `{0:manual,1/2:autonomous}`；`status` 由 `mission_state.state` 映射 `{0:idle,1/2:moving,3:stopped,4:error}`。

---

## 附：数据源文件索引

| 模块 | 关键文件 |
|------|----------|
| MCP 工具 | `ros2_mcp_server/.../mcp_server/{ugv,npc_tank,gimbal_control}_mcp_server.py`、`MCP_TOOLS_LIST.md` |
| 区域侦察载荷 | `actor_control/.../gimbal_control/area_recon_scan.py` |
| MQTT 映射 | `ros2_mqtt_bridge/config/bridge_config.yaml` |
| 实体传感器 | `actor_spawn/.../{ugv,npc_tank}/spawn_*.py`、`camera/spawn_gimbal_camera.py` |
| 自检/健康 | `actor_control/.../vehicle_state_node.py`、`anomaly_management/{anomaly_types,health_node}.py` |
| 裁判上报 | `referee/referee/*.py`、`referee/config/entities.yaml` |
| 消息定义 | `isr_ros2_msgs/msg/*.msg` |
| 视频推流 | `image2video/config/streams.yaml`、根目录 `*.sdp` |