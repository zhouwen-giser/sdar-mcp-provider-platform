# 1.5.2 只读规划分项准入

父合同 `site-interop-v1`、1.5.1 目录、部署 /3、预览 /2 及适配器保持原字节和原哈希。1.5.2 目录仍为 15 项工具，使用显式部署 /4 的 `planner.readinessPolicy=runtime_scene_and_entity_v1` 和预览 /3。

只读请求先从同一部署端点读取场景、地图、三个 GNSS 样本及 watchdog 的新鲜 runtime 状态。必须匹配 owner、profile run、非零 epoch、地图和场景；运行阶段为 RUNNING/DEGRADED，并明确开放 scene、motion:ugv 且 accepting_commands=true。场景加载、停止、切换、身份冲突或缺少组件准入均拒绝。组件健康 level=0 不参与替代判断。

上游 `runtime_owner.py:set_phase` 将 DEGRADED 映射为场景 failed；`RuntimeAdmission.allows` 则依据新鲜状态、accepting_commands 及 ready_control_groups。整体降级和本操作组件可用可以同时成立。结果显式保留两者、故障原因及源证据哈希，不将 failed 改写为 ready。

同连接设备/任务上下文、请求 ID、ACK、epoch、ENU 和路线几何校验继续生效；只能发送 plan_route。预览不会创建导航任务或更改设备状态。控制仍有独立完整参数检查、任务确认及写端租约。

现场已是 yuan_qu，WGS84/ENU 参考来自实际配置和三点转换核验；不沿用旧机场坐标。参考平面高度不是实测地面高度。合同锁通过 `pnpm exec tsx scripts/ugv-zmq/planner-admission-contract.ts` 验证。
