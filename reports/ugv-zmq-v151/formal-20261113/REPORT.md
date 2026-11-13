# ZMQ 1.5.1 正式服务切换

## 交付结果

2026-11-13 已完成 SMPP 正式版本切换：

- MCP：`http://17.26.1.20:19100/mcp`，精确目录 `zmq_v1_5_1_site_control_15`，15 项工具，控制模式、匿名授权域保留。
- 面板：`http://17.26.1.20:19101/`，HTTP、原操作员账号和本地审计保留。
- Provider / Runtime：固定源码 `ada745829c635b9bb56d6017c2c2faf7f31e544e`；面板修复源码 `eafe1ac2e2db053503f28ad06719c63650b01d7d`。
- 本次现场设备动作 **0 次**；正式部署通过，现场动作及报告完整性未代为验收。

## 稳定性接受依据

用户明确授权：“可以提前结束24 小时验证! 认可当前稳定性通过, 允许切换为正式服务”。

第三轮封存实际 **71,215 秒（19:46:55）/ 1,187 样本**，完整哈希链和容器身份通过，无运行错误、重启、OOM。原始 run/summary/journal 保留于 `accepted-soak/`。`operator-acceptance.json` 明确 `actualFull24HoursObserved=false`、`acceptanceBasis=operator_approved_shortened_observation`。原始摘要未改写为自动 24 小时通过，也未拼接前两轮时长。

## 交接与接收会话

1. 原受限 GOWM owner 验证通过，活动任务/接纳/占用/待处理命令/未确认派发均为零。
2. 现有管理 CLI 固定旧 Runtime/Provider ID、镜像和快照哈希，关闭旧重启策略、停止写端，以唯一 commandId `a3a3b833-6a37-4c40-9702-1677215e47e2` 提交并核实新配置交接。退役任务数为零。
3. 关闭候选，正式观察分区 `site-control-v151-formal-20261113` 接续候选持久尾部。归档事件明确记录旧 session/ordinal/headHash；不重放未确认批次，也不修改旧水位和历史记录。
4. 正式定位重新达到接收新鲜，三路原生数据及归档 running。底盘 producer epoch/源时钟仍保留未认证质量，不把 Dashboard epoch 写成底盘事实。
5. 新控制端三个命令端点独占锁均被核实；后台初始化未恢复或重派旧运动任务。切换后任务库仍空闲。

此处是用户授权正式部署的明确进程/接收会话交接，不是为隐藏时间回退而自动重启候选。原候选时间回退隔离证据保留在前次 followup。

## 验证

| 验证项 | 结果 / 证据 |
| --- | --- |
| 正式匿名目录、伪造身份头、无效 JWT | 15 项精确匹配；身份覆盖忽略、无效 JWT 拒绝，`mcp-live.json` |
| 新鲜定位、三路订阅、归档及会话边界 | 通过，`mcp-live.json` / `source-preflight.json` |
| 参数化可用性（不执行控制） | 导航与云台角度 available；光学变焦 disabled，`availability.json` |
| 命令端点独占及空闲 | 三个锁通过、数据库无活动控制，`writer-locks.json` |
| LAN 地址浏览器与原图 | HTTP 登录、1280×720 JPEG、长度/SHA256 下载校验、历史记录、移动布局通过，`browser-verification.json` |
| 1.5/1.5.1 表单继承修复 | 4 项渲染回归、类型检查、Lint、构建通过，`console-fix-checks.json`；真实页面验证 km/h 默认 60、区域零高度说明与视场入口 |
| 原工程门禁 | 沿用无变化代码的 171 单元、124 PostgreSQL/MCP、两代控制各 10、80 面板及浏览器证据，不重复无关门禁 |
| 固定镜像与容器/配置保护 | `formal-verification.json` / `console-build.json` |

面板只修正版本判断，Provider/Runtime 应用镜像保持已接受的版本。部署的资源边界与候选一致：Provider/Runtime 各 1 GiB、2 CPU，Console 512 MiB、1 CPU。

## 保留的限制

- 现场场景在切换前再次报告 `failed / DEGRADED`。规划仍返回 `UGV_PLANNER_SCENE_UNAVAILABLE`，没有制造替代路线或发送导航。最初严格要求场景 ready 的只读探测失败被保存，随后仅核实部署所需的场景/设备一致性及静止；不将这次改为规划通过。
- 光学变焦 `ZMQ_OPTICAL_ZOOM_UNSUPPORTED`；独立仿真视场 `ZMQ_VIEW_BACKEND_NOT_CONFIGURED`。入口显示实际原因，未以目录发布冒充可执行。
- 源时间、producer epoch、曝光 UTC、覆盖和发现流完整性仍按真实证据报告。原图与接收新鲜不补足这些证据。
- PMS 网关保持原容器/网络和旧只读兼容目录；SDAR 精确绑定未修改，不宣称 SDAR 自动接受新的 15 项目录。

## 保护、回退与证据

六个原凭据/配置文件摘要不变，受限数据库、原绑定、任务与报告保留。PMS 配置及轨迹签名目录保留原挂载；未对不存在的历史密钥做内容不变声明。主目录和仿真端没有改动。

只读回退配置在宿主私有交付目录 `rollback/`，使用同一新协议镜像与显式接收变体、正式存储/账号及明确后继会话；回退前仍检查任务与写端，不恢复旧 MQTT 写端或旧协议镜像。操作说明见 `deploy/ugv-zmq/v151/FORMAL-20261113.md`。

`commands/` 是实际执行脚本的副本，精确命令、退出码与日志哈希见 `cutover.json`、`handoff-apply-receipt.json`、`probe-commands.json`、`console-*.json`。`SHA256SUMS` 固定本目录文件；私有 provider/env、凭据和原图未入包。正式部署包另有独立回执。
