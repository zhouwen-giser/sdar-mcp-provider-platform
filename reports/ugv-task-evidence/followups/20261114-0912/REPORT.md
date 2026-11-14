# 2026-11-14 指定坐标导航测试

## 实际结果

按本轮用户明确授权，测试导航至 WGS84 `114.04791045,22.50664785`。先从新鲜定位生成 **一次 8 点规划**，随后通过正式 HTTP 面板登录会话采用为 **一个新导航 Task**。沿用已确认的 60 km/h 上限、避障开启、立即启动、60 秒启动容差及 300 秒执行预算。

任务于北京时间 **09:12:36.050** 创建，**09:12:45.381** 因 `ZMQ_MODE_ECHO_TIMEOUT` 失败。三次 mode=1 已进入命令账本，路线、速度、避障和 START 均未下发。本次没有观测到车辆移动：四次新鲜定位采样完全相同，ENU 速度均为零；未到达指定目标。

| 项目 | 标识/结果 |
| --- | --- |
| 规划 command | `ade095b0-16cc-4011-b5f1-ca33368d3dea` |
| 规划来源 | `7951d1f5ac333de2fbe012aa3b85f9f2b533a5aed7b6e153bf6e02ec62f9a417`，地图 `yuan_qu` |
| 导航 command | `1d74b12f-cbb6-4655-b7c1-903634214ff4` |
| MCP Task | `d1204c9e-90b6-4ac4-bc84-2d31ce62830c` |
| 原生命令 | 09:12:36.050、09:12:39.073、09:12:42.072，mode=1，均 sent_unconfirmed |
| 终态 | completed、isError=true、business_failure，`retryable=false` |
| 采样位置 | `114.04776722767852,22.505954788642917`，本轮采样位移 0 米 |
| 后续状态 | mode=0，无设备任务/执行；本任务 occupancy=released；归档 running，无未确认接收或本地丢弃 |

任务、规划、实际参数及原始结果：[navigation-summary.json](navigation-summary.json)。原生命令：[native-execution.json](native-execution.json)。定位采样：[positions.json](positions.json)。[正式任务详情截图](navigation-result.png)。

## 准入与派发边界

派发前定位及状态新鲜、底盘静止，无设备任务/规划/执行，完整参数检查返回 `available / ZMQ_SITE_OPERATION_READY`。面板采用新预览，后端再次核验目录、来源、转换、新鲜起点及完整参数。预览创建和导航提交分别为一次，没有重用旧 Task 或重派旧失败命令；浏览器脚本仅允许目标、规划点、速度、避障及预算与本轮冻结参数相符的请求。

准入：[preflight.json](preflight.json)。数据库审计仅有本导航 command 的一条记录，actor=operator，创建及受理记录已核实：[navigation-audit.json](navigation-audit.json)。账号通过既有服务端登录流程使用，没有输出凭据。

模式回显问题仍存在，本轮不计为导航动作通过。当前诊断保持此前结论：等待模式匹配是上游明确要求，不能以规划成功或 PUB send 完成代替应用确认；接收端实际解码/模式处理记录仍缺失，未自动变更发送格式或绕过门禁。四项来源与关联证据限制保留在原报告中。

本轮无应用代码、镜像、部署及上游改动，没有重复运行已通过且代码未变的软件门禁。实际测试脚本退出 0 表示已记录真实失败结果，不表示业务成功。首次复制审计脚本误引用本轮不存在的 env 路径，数据库访问前即失败；改用 canonical env 后仅重跑只读审计，未重新提交导航。

命令与退出码：[commands.json](commands.json)。私有证据哈希：[raw-evidence-hashes.json](raw-evidence-hashes.json)。公开文件校验：[SHA256SUMS](SHA256SUMS)。
