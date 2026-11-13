# 定位回退处置与指定坐标导航复测

## 结果

2026-11-13 16:14，正式 `19100/19101` 已完成受审计接收会话处置。16:15、16:21 对目标 `114.04791045,22.50664785` 的完整参数检查均返回 `available / ZMQ_SITE_OPERATION_READY`，原 `ZMQ_STATE_STALE_OR_DISCONNECTED` 阻塞已解除。

按用户本次指定目标，通过已登录 HTTP 面板新建 **一次** 单点导航任务，沿用 60 km/h 上限（16.666666666666668 m/s）、避障开启及 300 秒预算。任务已受理，但在 16:18:21 以 **`ZMQ_MODE_ECHO_TIMEOUT`** 结束。仅发送三次 mode=3，没有下发速度、避障、路径或 START。本轮不计为导航动作通过，未重复提交或重派旧任务。

## 原因与修复

16:01 观测显示归档正常、三路连接新鲜，但当前接收会话最后可投影定位停在 15:34:53，`timeUs=19716530657`。独立 SUB 实际收到新定位 `1591681897 → 1591730685 → 1591775428`，均通过显式长度/CRC 合同、连续递增且速度为零。当前会话的防回退逻辑正确隔离这些新帧，因而导航缺少新鲜定位。证据：[state-before.json](state-before.json)。

只在 SMPP 新增可选配置 `recoveryPredecessor.boundaryReason=source_restart_operator_reconciliation`。它要求前驱会话已 clean-close，profile、合同和完整组件配置相同，继续核对设备及授权域；新会话记录前驱持久尾部，使用明确的 `RECEIVER_SESSION_STARTED_AFTER_SOURCE_RESTART_RECONCILIATION` 断档标记。旧配置的协议升级语义不变，普通断线/重放不会自动切换会话。没有修改 MCP 目录或冻结迁移。

未清除运行中会话水位、删除旧归档、认证不存在的底盘 producer epoch、修改/重启仿真端或修改 SDAR。Dashboard epoch/控制器变化作为人工处置旁证，`sourceProducerEpoch` 仍为 null。

## 交接与正式验证

- 源码：`1a014d46ed94f6dd6845dc28201678f22fc3c387`；Provider 镜像：`sha256:a33f44c2cdeb789a27c71578e9254426f631342bd6d4432cc6bdfb8a6ed185b2`。
- 交接 commandId：`0152f31b-6c3f-4e5b-a71f-e41810803e45`。先停止 Console 新入口，再冻结最终快照，经 plan/apply/verify 停止旧 Runtime/Provider 并禁止其自动重启。任务、命令、接纳、占用均为空，退役 Task 为零。
- 旧接收会话：`820fe511-bd30-4db2-9734-a763dc9d34eb`；封存为 closed，最终 ordinal/head hash 见 [receiver-tail.json](receiver-tail.json)。新会话：`41ed7fbf-7618-4182-b17a-aa46368d8343`；新分区：`ae9a6135bc73ebaa9d9c7edf899383c89bdd566a4710d507335c46ffe79a5df9`。
- 只更新 Provider 镜像；Runtime/Console 沿用已验证镜像，经交接重建。HTTP、匿名 MCP、账号、绑定、数据库、PMS 网关及签名目录保留，15 项目录精确校验通过。三个端点独占锁已核实。
- 旧任务 `2c9d0e50-b9d2-408f-aa95-d5af2532cc02` 仍可读取，原业务失败保持不变。封存前驱的尾部在恢复后未变化。新定位接收新鲜，三路与归档正常；对本次目标的只读规划取得 8 点路线，保持未采用。

命令与退出码：[recovery.json](recovery.json)。边界校验、目录、锁、历史及预览：[recovery-verification.json](recovery-verification.json)。恢复与复测后状态：[state-after.json](state-after.json)、[state-post-test.json](state-post-test.json)。固定容器身份：[containers-final.json](containers-final.json)。

## 指定目标复测

| 项目     | 实际结果                                                        |
| -------- | --------------------------------------------------------------- |
| 面板命令 | `da5bfdf9-86ee-4e06-8326-2dce6bbd8820`                          |
| MCP Task | `df36da29-11b0-4d89-9a99-44658d19f958`                          |
| 受理时间 | 16:18:11.821                                                    |
| 原生请求 | mode=3，16:18:11.956、16:18:14.980、16:18:17.989                |
| 终态     | 16:18:20.976，业务失败 `ZMQ_MODE_ECHO_TIMEOUT`                  |
| MCP 状态 | completed，但 isError=true，不作为业务成功                      |
| 原生帧   | sender=0、target=1，严格 2.1 长度/CRC 与 C++ 参考解码通过       |
| 运动派发 | 路径/START 均未发送，没有再提交导航 Task                        |
| 后续状态 | 底盘 mode=0、无活动任务，当前位置与测试前相同，三条新定位均零速 |

操作员审计确认仅创建/受理一次：[navigation-audit.json](navigation-audit.json)。完整面板命令与查询：[navigation-test.json](navigation-test.json)，过程日志：[navigation-test.log](navigation-test.log)，原生帧验证：[navigation-frame-check.json](navigation-frame-check.json)。[导航准入截图](navigation-available.png)。

底盘模式回显问题仍待真实接收端日志。已请求 `ros2_zmq_server_sl` 在约 16:18:10–16:18:22 的解码/模式处理记录。标准参考解码通过不能证明现场二进制接受；不自动切换控制发送格式、改短路成功或重复试发。

## 软件门禁

| 命令                                     | 退出码/结果                       |
| ---------------------------------------- | --------------------------------- |
| 修改文件 ESLint                          | 0                                 |
| 观测单元与真实隔离 PostgreSQL 测试       | 0，38 项通过，含 6 项新增处置场景 |
| `pnpm typecheck`                         | 0                                 |
| `pnpm build`                             | 0                                 |
| `pnpm verify:frozen-protocol`            | 0                                 |
| 固定源码 Provider Docker 构建            | 0                                 |
| 已登录正式 HTTP 面板新任务提交及终态查询 | 脚本 0，真实业务失败另记          |

完整命令和日志：[gates.json](gates.json)、[observer-tests.log](observer-tests.log)、[provider-build.json](provider-build.json)、[navigation-test-command.json](navigation-test-command.json)。隔离测试仅使用自有测试 PostgreSQL 容器，已停止并保留卷；生产数据库没有运行测试迁移。首次手工只读检查误写 `target` 参数，被实际 Schema 以 `INVALID_TOOL_ARGUMENTS` 拒绝，按合同改为 `destination` 后复核，没有设备派发。

原始私有证据及哈希：[raw-evidence-hashes.json](raw-evidence-hashes.json)。本轮不声称新的 24 小时稳定性通过，既有心跳监控保持暂停。
