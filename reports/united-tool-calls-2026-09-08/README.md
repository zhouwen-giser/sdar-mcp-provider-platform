# SMPP 10 个工具真实调用测试

2026-09-08，现场端点 http://17.26.1.20:19100/mcp。用户确认设备为纯软件仿真，并授权中断任务、驶近给定侦察区域及解除仿真发射禁用。调用真实已部署服务，不使用 mock。

**10/10 工具均已发起 tools/call，6类得到成功结果，不能宣称10项全部通过。** HTTP 200 不代表业务成功；本报告依据 isError、任务终态及设备观测分别判断。

| 工具 | 判定 | 结果 |
| --- | --- | --- |
| vehicle_get_state | PASS | 真实状态读取成功，MQTT/设备 MCP 在线 |
| vehicle_get_capabilities | PASS | 设备能力成功返回；laserRange=false |
| vehicle_get_payload_status | PASS | 返回载荷、覆盖及云台状态 |
| vehicle_get_targets | PASS | 连续采样实际发现目标 ID 47；后续样本可能为空 |
| vehicle_navigate | PASS_POINT_WITH_DISTANCE_ANOMALY | 用户指定点位完成，误差0.621米；另一次1米距离导航回报完成但位移0米 |
| vehicle_area_recon | PARTIAL | 显式targetTypes=[]后设备扫描424/424格、100%；SMPP关联弱，最终确认超时 |
| vehicle_track_target | REJECTED | 实际发现目标47在后续调用时返回UGV_TARGET_NOT_FOUND |
| vehicle_control_gimbal | FAILED | 初次EO占用；重试受理后出现UGV_DOWNSTREAM_MISSION_ID_MISMATCH，已取消并急停清理 |
| vehicle_fire_weapon | BLOCKED_AFTER_ENABLE | 原UGV_FIRE_DISABLED已解除并持久化；目标47调用被UGV_STATE_STALE拒绝，未实际仿真发射 |
| vehicle_emergency_stop | PASS | 收到STOP_CONFIRMED，末次速度0、目标解锁 |

## 指定导航与区域

用户目标 lon=106.81312856, lat=29.72041222：任务 b53d1885-05c1-4b4b-8abf-34a8fb071bd2 完成，终点 lon=106.81312214198879, lat=29.72041258021921，误差0.621066米，移动128.533米，停车。GOWM原生Mission链接为LINKED。

随后按用户授权驶近侦察区域，到 lon=106.8131, lat=29.7192 附近，移动134.563米。四顶点未改动，详见 recon-explicit-types.jsonl。区域设备报告完全可覆盖，距离57.2–121.3米、探测半径140米；一轮扫描424/424格、100%。这仅证明设备端效果，SMPP任务9cbda503-af0d-4545-819d-d7458ed253ad最终为UGV_PHYSICAL_CONFIRMATION_TIMEOUT。

recon-target-capture.jsonl连续采样捕获目标47，来源mqtt_area_recon。后续跟踪未成功；再做一次发现即调用采样未捕获目标，未编造或注入目标。

## 配置与接入问题

现场 /mnt/data/smpp-united-current/smpp/deploy/development/server/.env 的 ADAPTER__UGV_FIRE_ENABLED 已由false改为true；state/compose.json同步修改并保留.before-simulation-fire备份。仅重建SMPP Adapter，Runtime因目录健康状态残留失败随后重启恢复就绪，未重启上游GOWM服务。输入required confirmation及现有其他检查保留；没有修改源码或镜像，也未重新生成原归档。fire-discovered.jsonl显示已不再被禁用开关拦截，但状态过期，因此没有仿真发射成功证据。

发现的接入问题：

- 侦察省略targetTypes会映射为null，现场schema要求数组；显式[]后成功下发。未修改实现，仅用合法参数绕开默认值兼容性问题。
- 云台任务ID关联异常，侦察弱关联/终态确认超时。设备完成与MCP任务成功不能混为一谈。
- 一米距离导航报告完成但观测位移0；点位导航正常。
- 目标瞬态消失及状态新鲜度检查阻塞跟踪/发射闭环。
- telemetry-issue.json记录PROVIDER_TELEMETRY_TRANSPORT_FAILED；部署模板ADAPTER__PROVIDER_TELEMETRY_ENDPOINT使用127.0.0.1:7002，是需要核对的容器间连接配置。尚未修改或宣称修复。

## 数据库与收尾

database.json证实急停/导航写入gowm数据库ugv_smpp.provider_task；两次导航关联gowm_execution中的原生Mission。急停的无原生Mission链接为PENDING，未误报全部链接已完成。final-database.json保留后续任务审计快照。

最后急停任务830f48b8-0484-4f14-a9d3-4141d8933c0c完成STOP_CONFIRMED，速度0、目标解锁，见final-stop.jsonl。最终就绪与开关证据见final-runtime.json。

原始JSON/JSONL包含现场仿真遥测和位置，按内部测试数据管理；不含数据库密码。未进行额外输出schema验证：本机jsonschema版本不支持Draft202012Validator，不能把该检查计为通过。
