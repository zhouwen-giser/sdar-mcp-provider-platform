# 22:38 规划导航模式回显复核

## 结论

用户的新任务已通过准入并发送模式命令。等待模式确认的阶段阻止了后续路线下发；本次没有观测到符合要求的设备回显。原始状态均被本地接纳，未发现正确回显被校验丢弃。

- 预览 command `4cac64bb-df57-4f55-bddf-8913332b8abf`：22:38:35 创建，8 点，地图 `yuan_qu`，来源 `62010ff5d271f08efa21e1a994f098d196473af3a48f90e7228bfe4e941a9ece`。
- 导航 command `cad799e2-889c-4072-9b3b-328d9a3a5e50`，Task `1da1cf4f-ecae-493d-a97b-ce4673ac71e6`：22:38:38.354 创建，22:38:47.814 以 `ZMQ_MODE_ECHO_TIMEOUT` 结束。
- 22:38:38.361、22:38:41.387、22:38:44.395 三次 mode=1 派发，send 完成但应用层未确认。没有速度、避障、路线或 START 派发。
- 对当前接收会话归档执行有界只读查询：**22:38:30–22:39:00 的 30 条 systemState 全部 valid/projectable，mode 全部为 0**。同期 480 条定位、30 条 failsafe 和 30 条性能消息均有效、可投影，没有漏读 mode=1 的证据。
- 独立 XPUB 诊断从 10001 收到 `ad_remote_command:` 和 `call_task:` 两项订阅；诊断发送应用帧为零。现有 TCP 连接 ESTAB，发送队列为零、字节已获 TCP 确认；这不能替代接收进程解码及应用证明。

时间为 Asia/Shanghai。任务摘要：[task-summary.json](task-summary.json)。30 条原始状态及归档引用：[archived-system-states.json](archived-system-states.json)。订阅：[subscription-probe.json](subscription-probe.json)。TCP：[command-tcp.txt](command-tcp.txt)。

## 门禁与协议

当前上游协议 §4、§7 明确要求：切到对应模式，等本车新状态回显匹配，再下发任务；每次等待 3 秒，最多发送三次。SMPP 的 `mode_wait` 实现与此一致。上游 `Controller::accept` 也检查路线任务所需 mode=1，当前模式不符会返回 `task does not match applied mode`。因此绕过本地模式确认不能修复该接收链路。

需要继续核实的是 10001 的实际接收格式及处理记录：

| 方向 | 已观察/配置的格式 | 实测 |
| --- | --- | --- |
| SMPP → 10001 模式命令 | `prefix_wire_length_crc`，标准 2.1 | len=8，线路 8 字节，业务 4 字节；完整线路 CRC 有效，单帧 sender=0、target=1。与此前参考解码通过的模式帧逐字节相同。 |
| 11001 → SMPP 状态 | `prefix_business_length_crc`，已显式配置接收兼容 | 样本 len=16，线路 20 字节，业务 16 字节；仅业务 CRC 匹配，完整线路 CRC 不匹配。本地按既定兼容合同正确读取。 |

以上差异是**发送与现场接收实现不一致的候选原因**，尚不能从发布格式推定 10001 的解码格式。当前源码的编解码均要求线路长度/CRC；现场发布样本与该规则不同，需要实际进程的错误日志确认运行实现。不能把 RX 兼容推断为已经验证的 TX 合同，也没有自动切换编码。逐帧校验：[wire-comparison.json](wire-comparison.json)。固定源码位置和 SHA256：[source-references.json](source-references.json)。

已请求 `ros2_zmq_server_sl` 在 **22:38:38–22:38:48** 的 `invalid frame`、`received/applied mode` 或业务拒绝日志，或可用只读日志访问方式。此前只读 SSH 返回 Permission denied，尚无现场接收进程记录。获得记录后：若明确拒绝长度/CRC，在本项目新增明确版本的发送兼容合同并先隔离验证；若已解码但拒绝，则按具体拒绝原因修正准入；若已应用但发布不匹配，则核对实际来源和回显。保留模式确认及失败任务不重派规则。

## 变更边界

本轮仅只读查询已有 Task、命令审计、原始归档和接收端订阅，未新建控制 Task、未发送应用控制帧、未重启服务、未修改源时间水位或上游。四项报告证据限制继续保留，不作为本次模式超时的拒绝条件。

应用代码、镜像及部署保持不变，没有重复运行已通过且代码未变的软件门禁。导航现场验收仍未通过，接收端根因待上述证据。实际命令/退出码：[commands.json](commands.json)。私有原始证据哈希：[raw-evidence-hashes.json](raw-evidence-hashes.json)。公开文件校验：[SHA256SUMS](SHA256SUMS)。
