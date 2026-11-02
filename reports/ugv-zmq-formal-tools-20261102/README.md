# 正式服务与工具目录切换（2026-11-02）

正式 MCP：<http://17.26.1.20:19100/mcp>；HTTP 面板：<http://17.26.1.20:19101/>。

## 实际结果

- 已部署固定源码 `58d3d734` 的 Runtime、Provider 和面板镜像，目录为 **1.4.0 / zmq_v1_4_0_site_control_14**，十四项工具全部发布。
- 原有六类控制已开放参数表单和提交准入：导航（单点/路线/返航）、云台角度/有限租期角速度、区域侦察、环视、区域检查、仿真效果。逐次派发仍校验完整参数、实时状态、身份和占用。
- 11 项具体操作配置为支持。路线、返航及扫描按已确认原生合同、完整隔离软件验证和本轮操作员启用授权开放，**未因此计为现场验收通过**。
- **光学倍率**仍为 `ZMQ_OPTICAL_ZOOM_UNSUPPORTED`。**独立仿真视场**入口已发布，因现场 `067529e82-dirty` 与现有 SDK 不匹配、真实场景/车辆 Actor 未绑定，返回 `ZMQ_VIEW_BACKEND_NOT_CONFIGURED`。不能将二者描述为已可执行。
- 三路订阅已重连并取得新鲜状态；源 epoch、时钟语义、完整覆盖和发现流仍未获上游证明。当前无有效地理观测目标；观测目标效果需要有效引用，人工目标保留独立来源。
- 发送/接收超时分别为 1000/2000 ms。阶段诊断和逐操作准入已随新版镜像生效。

## 占用、数据和验证

旧路线任务 `f49b6c69-048c-48d4-b935-4aca6d343348` 通过当前新鲜空闲状态、多帧零速定位和任务状态完成审计对账，释放占用；原 `ZMQ_STOP_UNCONFIRMED` 和未知结果保持原值。

候选与正式各 21 项检查通过，包含两项**既有查询过期的行为一致性**，并非所有旧任务都可继续查询。浏览器实际登录、七类表单、两个禁用原因和手机宽度无溢出通过；初次浏览器沿用系统代理失败，使用本机直连参数复测通过，未修改系统代理。

原任务已在切换前超过 MCP TTL，新旧 `tasks/get` 均返回 `TASK_EXPIRED`；未修改历史期限。原数据库报告仍保留，三个原结果内容哈希一致，派发日志前后均 22 条。本轮没有发出新的设备动作。

## PMS / SDAR

原 PMS 内部网关保留原逻辑名称、两个网络及 IP，转发至内部 19112 的独立只读兼容 Runtime。兼容 Provider 只订阅，不构造控制引擎；只读 Runtime 禁用调度、派发和恢复。其独立观测档案分区避免重复档案写锁，原档案保留。

只读工具目录与切换前逐项完全一致。SDAR 原匿名 Binding revision 3、PMS registry revision 15 和 checksum 保持不变，续查正常；正式只读 A2A 任务 `ca4e0707-71b2-4132-9a20-f01a3ae0c9e9` 完成。**新 14 工具控制目录未在 SDAR 治理发布，SDAR 保持七项只读能力。** 面板和直接 MCP 使用正式 14 工具目录。

## 配置与回退

实际配置保存在服务器权限 0600 的 `/home/sz/.smpp-debug/ugv-zmq-formal-tools-20261102/`，本报告仅记录文件哈希。`formal/site-images.env` 和 `formal/pms-readonly-override.json` 是当前正式编排参数；`readonly-compat/compose.json` 保存兼容服务。候选三服务停止且 restart=no。原数据库卷、账号、设备绑定、PMS 凭据和轨迹签名密钥保持原值。

回退先关闭控制准入并核实/对账当前任务，停止控制写端，再用原 `/home/sz/.smpp-debug/zmq-site-control-20261026/formal-readonly/site-images.env` 与仓库 `deploy/ugv-zmq/site-control/compose.formal.yaml` 恢复三项正式只读应用。内部 PMS 网关可继续指向已经验证的只读兼容服务。保留全部观测、任务、结果与审计；不恢复旧 MQTT 写端。

`deployment.json` 记录实际镜像及逐操作状态；`verification.json` 记录准入、浏览器和 SDK 结果；`reconciliation.json` 记录对账依据；`commands.json` 固定命令、退出码和原始私有证据哈希。`SHA256SUMS` 校验本报告。
