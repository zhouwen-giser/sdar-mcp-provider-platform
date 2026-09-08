# 侦察 → 跟踪 → 仿真发射再次测试

2026-09-08 17:12–17:14（北京时间）。用户已确认纯软件仿真，继续使用原四顶点侦察区域和现场SMPP入口。

**本轮链路未通过，阻塞在侦察调用与Runtime任务发布阶段。没有进行跟踪或仿真发射。**

| 阶段 | MCP结果 | 下游实际结果 |
| --- | --- | --- |
| 状态预检 | HTTP200，状态读取成功 | MQTT/设备MCP在线 |
| 区域侦察，scanCount=0、targetTypes=[] | HTTP500 / -32603 | 实际创建Mission 41923，后被清理急停取消 |
| 清理急停 | HTTP500 / -32603 | 实际SUCCEEDED / STOP_CONFIRMED |
| 跟踪、仿真发射 | 未继续调用 | 无本轮成功证据 |

侦察Provider任务为b25ed469-8384-4cea-ae55-5af78e9b906d，09:12:56.633Z创建；急停为a50c9618-fb17-4f06-b752-7649d0435404，09:13:00.257Z创建。correlation.json核对了原始区域、参数、创建时间；两者mcp_task_id均为null。

Runtime错误摘要显示Adapter RPC在5秒后DEADLINE_EXCEEDED；任务恢复反复触发PostgreSQL 23503，约束smpp_reconciliation_audit_device_id_task_id_fkey，审计引用任务不在provider_task中。它们是直接观察到的故障，尚未证明哪一个是最初根因。

HTTP500不能视为“未执行”：本轮侦察和急停均在Provider层留下实际执行记录。为避免重复副作用，没有再次投递相同操作或继续使用上一轮过期目标。下游最终急停成功，侦察取消；Runtime任务恢复问题尚未修复。

前轮已按用户要求持久化UGV_FIRE_ENABLED=true；本轮没有改配置、绕过确认、修改源码或数据库记录。

证据：chain.jsonl为实际请求/响应，runtime-errors.json为脱敏日志摘要，database.jsonl和correlation.json为只读数据库查询，summary.json为机器可读结论。
