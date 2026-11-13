# 采用规划后的导航结果与排障记录

## 结论

2026-11-13 15:27:21 的 8 点规划成功。15:27:27 的“采用并导航”也已受理，生成独立 Task `2c9d0e50-b9d2-408f-aa95-d5af2532cc02`；15:27:36 以 `ZMQ_MODE_ECHO_TIMEOUT` 返回业务失败。原页面没有在预览旁展示这个任务，所以仍显示“尚未采用”和历史 Dashboard 降级说明。

15:50 仅更新正式 HTTP Console `19101`。页面现已关联原命令和 Task，直接展示业务失败、失败阶段及 Task ID；同一预览禁止重复提交，刷新只恢复查询。真实登录、刷新、打开原 Task、移动布局验证通过，浏览器修改请求只有登录，没有命令提交。Provider、Runtime 的容器、镜像和启动时间未改变。

**页面问题已修复；底盘未回显的接收端原因尚未确认，导航动作验收仍未通过。** 本轮没有重派失败导航、发送新的设备命令、修改仿真端或清除接收水位。

## 原任务与南向证据

| 项目         | 证据                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| 预览命令     | `4a5a6d94-41d1-4747-a243-6098afb9e4f4`                                              |
| 原始来源     | `15276473b2cb700958c8cbaf0ea3f64effcdf96afa93619f2c9c4b15322715f9`                  |
| 导航命令     | `88615ac3-25bd-4188-a090-c722ec0face1`                                              |
| MCP Task     | `2c9d0e50-b9d2-408f-aa95-d5af2532cc02`                                              |
| MCP 状态解释 | `completed`，但 `result.isError=true`、`outcome=business_failure`                   |
| 原生请求     | 三次 `chassis.mode`，分别在 15:27:27.059、15:27:30.060、15:27:33.071，要求 `mode=1` |
| 帧验证       | `sender=0`、`target=1`、`len=8`、业务前缀 4；严格 2.1 长度/CRC 验证通过             |
| 传输状态     | `sent_unconfirmed` / `ZMQ_PUBLISH_QUEUED_UNCONFIRMED`，仅证明 PUB 已排队            |
| 未发送       | 速度、避障、路线配置、START 均未发送                                                |
| 导航参数     | 原记录为 60 km/h 对应 `16.666666666666668 m/s`，开启避障；本轮未改写                |

持久帧经独立 Python 校验和仿真端源码 `a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e` 的 C++ 参考解码器读取通过。TCP 连接及 `ad_remote_command:`、`call_task:` SUB 过滤器均存在。XPUB 诊断只读取订阅帧，未发送应用帧。这些证据不能代替实际接收端的解码、业务接受及模式回显。

原生任务执行 revision、三条命令账本和终态在更新面板前后完全相同。精确原始帧、回执、任务和审计的摘要见 [original-navigation.json](original-navigation.json)，独立校验见 [frame-check.json](frame-check.json)、[reference-check.json](reference-check.json)，未重派证明见 [no-redispatch.json](no-redispatch.json)。原始私有证据路径及哈希见 [raw-evidence-hashes.json](raw-evidence-hashes.json)。

## 页面修复

- 预览保持原始 `preview_only` 结果；独立命令承担采用记录。页面根据关联命令显示“已关联导航请求”，不改写历史规划报告。
- 查询原 Task 并解释业务结果，区分提交、受理、执行、暂停、等待输入、取消、失败和未知。HTTP 成功和 MCP `completed` 不等同于业务成功。
- 查询失败显示“结果未确认”，无 Task ID 或回执丢失不重新派发。再次提交需重新预览并确认。
- 重复点击、刷新恢复及精确资源/目录匹配已验证。历史 Dashboard 警告保留在原预览中，避免重复组件前缀。

正式页面：[formal-navigation.png](formal-navigation.png)。真实验证：[live-browser.json](live-browser.json)。

## 验证与部署

Console 源码：`cf5b0ae22b1d74b54fc803bd2f55b082ec583a85`。目录保持 `zmq_v1_5_2_site_control_15`，没有修改 MCP 合同。

| 命令/验证                                           | 退出码 | 证据                                                                                           |
| --------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------- |
| 修改文件 ESLint                                     | 0      | [gate-v2-0.log](gate-v2-0.log)                                                                 |
| `pnpm --filter @sdar/ugv-control-console typecheck` | 0      | [gate-v2-1.log](gate-v2-1.log)                                                                 |
| 预览导航及 Profile 两组单测，13 项                  | 0      | [gate-v2-2.log](gate-v2-2.log)                                                                 |
| `pnpm --filter @sdar/ugv-control-console build`     | 0      | [gate-v2-3.log](gate-v2-3.log)                                                                 |
| 生产静态构建隔离 Playwright，1 项                   | 0      | [browser-2.log](browser-2.log)                                                                 |
| Console Docker 固定源码构建                         | 0      | [console-build.json](console-build.json)、[console-build.log](console-build.log)               |
| 只更新 Console 的 Compose 命令                      | 0      | [deploy-console.json](deploy-console.json)                                                     |
| 局域网 HTTP 真实浏览器只读复核                      | 0      | [live-browser-command.json](live-browser-command.json)、[live-browser.json](live-browser.json) |

完整命令参数记录在 [gates-v2.json](gates-v2.json)。最初 ESLint 拒绝测试中的不安全 any，修正为实际 CommandSchema 解析后通过；记录保留于 [gates.json](gates.json)、[gate-0.log](gate-0.log)。最初开发服务器浏览器运行在刷新加载模块时发生 `ERR_NETWORK_CHANGED`，改用生产静态构建验证通过；初次失败说明保留于 [browser-1-failure.json](browser-1-failure.json)。没有重复运行未变化的 Provider/Runtime 软件门禁。

新 Console 固定镜像：`sha256:59f7de7585b01585a0afa9793e0af8425174896741e8a8d916c4a10244d15f91`。旧 Console 镜像 `sha256:17d464551bcab979bea0806a881ccd1cd072692a09f04adb6a3c230c9ed946f5` 保留，可仅恢复 `SITE_CONSOLE_IMAGE` 后重建 Console 回退。账号、授权、数据库、命令和任务均沿用原配置。更新前无 `dispatching` 命令，见 [predeploy.json](predeploy.json)。

## 仍待处理

1. 需要底盘实际接收端 `ros2_zmq_server_sl` 在 15:27:27–15:27:36 的 `invalid frame`、`received mode`、`applied mode` 日志或等价接收证据，区分解码拒绝、业务拒绝与未送达。不能从遥测的显式 business-length/CRC 接收兼容推断控制发送格式，也不能自动切换协议或延长超时掩盖失败。
2. 15:52 的只读复核发现上游 Dashboard epoch 和控制器身份已变化，运行状态已恢复 `RUNNING`。本项目最后可投影定位停在 15:34:53，后续源时间回退被隔离，三路连接与归档仍正常。这个新阻塞与原 15:27 的模式回显超时分别记录。Dashboard epoch 不能被伪装为底盘来源身份；须经受审计接收会话边界处置与新定位复核后，再生成新路线并由操作员确认。见 [source-boundary.json](source-boundary.json)。

现场动作、接收端原因和定位恢复尚未验收。本轮不声明导航已可用或新的 24 小时稳定性通过。
