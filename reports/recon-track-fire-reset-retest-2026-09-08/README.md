# 仿真重置后：侦察 → 跟踪 → 仿真发射重测

2026-09-08 17:17（北京时间），用户报告仿真环境已重置后执行。沿用用户原四顶点区域；现场发射开关保持前轮已授权配置，无本轮配置或代码修改。

**链路仍未通过。本轮所有请求HTTP200，侦察实际发现目标63，但跟踪及仿真发射均业务拒绝。**

| 阶段 | 实际结果 |
| --- | --- |
| 预检 | 四个只读工具成功，MQTT/设备MCP在线，区域完全可覆盖 |
| 侦察 | scanCount=0、targetTypes=[]，正常受理为任务4d813bf5-d6ed-4045-9c80-1ef0bb72b7f4，Mission41924 |
| 发现目标 | 半秒采样，真实返回目标63 |
| 侦察取消 | tasks/cancel应答200；随后六次、每次间隔约一秒查询仍为working/UGV_RECON_RUNNING |
| 跟踪目标63 | isError=true，UGV_EO_TRACK_BUSY，未产生跟踪任务 |
| 仿真发射目标63 | requireConfirmation=true，isError=true，UGV_STATE_STALE；未产生发射任务，无仿真发射 |
| 清理 | 侦察最终cancelled / UGV_CANCEL_DISPATCH_FENCED；急停任务b5e76957-7e5e-467e-9a4e-df8863774ac4 completed / STOP_CONFIRMED，速度0、目标解锁 |

本轮故障定位为取消侦察后的通道交接和发射前状态新鲜度。六次轮询只证明本测试观察窗口内取消未完成，不能据此断言永久无法取消。没有绕过通道仲裁、状态检查或发射确认。

GOWM只读核对：侦察和急停均存在于ugv_smpp.provider_task；Provider执行均带mcp_task_id；侦察原生Mission链接为LINKED，mission_instance_id=cabf14a3-1d69-4a13-9dba-fc86fcf9013e。上轮HTTP500及缺失Runtime任务记录现象本轮未复现，不能据此宣称其根因已修复。

原始证据：preflight.json、readiness.json、chain.jsonl、final.jsonl、database.jsonl。summary.json为机器可读结论。数据包含内部仿真遥测，不含连接密码。

## 取消路由复核补充

用户指出侦察不应使用移动任务取消后，已查实际GOWM命令日志和设备契约。侦察任务两次CANCEL均调用ugv_area_recon_control，参数为cmd_type=4、mission_id=41924；其规范JSON SHA256为b69264ccd11a955599d40dd159578809699b39d7285a03f1e3a6a78e4f470eb1，与两条命令日志完全匹配。没有将该侦察任务取消映射为ugv_mission_control。另行急停清理包含多个通道，与这两次侦察取消区分。

两次取消设备回执均accepted=false、UGV_DEVICE_TOOL_REJECTED；因此问题并非只是在六秒窗口内“还没完成”，而是下游明确拒绝了取消。顶层tasks/cancel HTTP200仅为协议应答，不代表设备接受。

同时，侦察start:02:followup也记为REJECTED，但Runtime曾显示running并收到目标。不能仅凭目标出现断言此次SMPP启动命令成功；启动、拒绝结果及状态关联之间也需进一步核对。日志保留结果哈希，尚没有足够证据确定设备拒绝的更底层具体原因。

证据：cancel-routing-audit.txt、cancel-acks.jsonl。此补充纠正前文将取消描述为单纯待完成的不充分判断。
