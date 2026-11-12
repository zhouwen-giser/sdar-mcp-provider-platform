# 22:30 现场场景降级复核

仅执行只读核实，应用/镜像保持 `ada7458`，未修改或重启仿真端、候选或正式实例，现场控制派发为零。

- 第三轮样本链与容器身份通过；无重启/OOM，归档正常且无本地丢弃，三路数据新鲜，原图按期读取成功。24 小时仍未满，不能判为通过。
- 前 22 次规划复核成功，从北京时间 22:00 起返回 `UGV_PLANNER_SCENE_UNAVAILABLE`。实际累计次数见 `verification.json` / `summary.json`。
- 场景接口返回 HTTP 200，但业务 `phase=failed`、`busy=true`、`can_switch=false`，错误指向 dashboard 对本机 `/api/watchdog` 的健康检查超时。
- 当前 `/api/watchdog` 可读取且组件 level=0，但其 runtime 仍为 `DEGRADED`、`fault_component=dashboard`；即使 `accepting_commands=true`，也不能覆盖固定的场景 `ready` 验证。
- 地图仍为 `yuan_qu`，GNSS 原点匹配。当前没有地图切换或坐标不符的证据。

源码核实：上游 runtime_owner 将 DEGRADED 映射为 failed；ScenarioController 从新鲜的 profile 状态转发该阶段。本项目规划器要求 scene.phase=ready，因而正确拒绝。本轮不调整合同来忽略该状态，也不执行上游恢复或设备命令。

`scene-api.json`、`watchdog.json` 保存实际响应及 SHA256；`samples.ndjson` 是摘要确认的完整前缀，`verification.json` 记录哈希链、源码哈希与归因。软件验收和此前现场成功证据仍保留，当前正式切换等待场景管理器恢复 ready 后再次只读核实。
