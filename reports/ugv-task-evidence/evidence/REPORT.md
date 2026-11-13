# 规划后导航：执行失败与报告证据说明

## 现场结论

2026-11-13 18:23，用户对 `114.04791045,22.50664785` 的操作已完成“规划 → 采用 → 创建导航 Task”。规划通过，执行失败。真实失败阶段是 **`ZMQ_MODE_ECHO_TIMEOUT`**：底盘模式切换没有取得回显，本任务没有下发速度、避障、路线或 START。

用户看到的四项 `missingEvidence` 是报告的可核验范围，在任务受理时记录；它们不等同于本次失败原因，也不表示平台 Task 不存在。不能通过隐藏这些标记将导航判为通过。

| 记录 | 标识与结果 |
| --- | --- |
| 规划 command | `17383eca-5d8a-4489-99e1-219ffdac8a9f`，18:23:40.214 创建，18:23:40.737 完成，8 点 |
| 规划来源 | `3374bc373588e2a23da74ad85e94dd592ac0e0723ac4a14b547d3fbe38cd3372`，地图 `yuan_qu` |
| 采用 command | `8db9d6b6-b5a9-4a5d-b856-351ab665fa2a`，18:23:47.193 创建，18:23:47.402 受理；引用上述预览 |
| MCP Task | `2f611987-f977-46c4-ba93-b6375b7cfc4b`，18:23:56.350 结束 |
| 实际参数 | 预览的 8 个点、16.666666666666668 m/s（60 km/h）、避障开启 |
| 业务终态 | `completed / isError=true / business_failure`，不作为成功 |
| 原生派发 | 18:23:47.304、18:23:50.322、18:23:53.331 三次 mode=1；均为 queued/unconfirmed |

时间均为 Asia/Shanghai。原预览仍是不可改写的 `preview_only` 报告，采用关联由独立 command 和 Task 保存。原始摘要见 [navigation-summary.json](navigation-summary.json)。同窗口另外两个用户单点导航 Task 也停在模式回显阶段；本轮仅查询已有记录，没有再次新建控制任务。

## 四项证据的含义

| 证据码 | 可确认的边界 |
| --- | --- |
| `SOURCE_PRODUCER_EPOCH_UNATTESTED` | 底盘消息没有可认证的生产者启动纪元。本地接收会话或 Dashboard epoch 不能代替设备来源身份。 |
| `CHASSIS_INITIAL_MISSION_STATE_NOT_OBSERVED` | 受理时未观测到有效底盘任务状态基线，无法据此核实设备此前任务；平台 Task 已独立保存。 |
| `CHASSIS_FEEDBACK_UNCORRELATED` | 原生反馈缺少足够的任务/请求关联信息，不能用于证明本任务的执行结果。 |
| `MODE_PUBLICATION_ORDER_UNVERIFIED` | 模式发布缺少可核实的命令关联或来源顺序；接收时间较晚不能单独证明由本次命令产生。 |

这些代码保留在结果和下载报告中。任务失败、降级和成功的原判定没有改变，未补造来源身份、任务回执、停稳或轨迹证据。

## 本地修正与正式页面验证

- Console 任务详情优先显示执行结论及中文原因；本次明确显示“驾驶模式切换未收到设备回显，路线尚未下发、导航尚未启动”。
- 报告证据单列为黄色说明，逐项展示中文含义及原始代码。未知代码继续显示，执行中的任务不使用陈旧结果覆盖当前阶段。
- 只更新正式 HTTP `19101` Console。源码 `09cae489e4460a7f5834fe542887aa9bc18fb57d`，镜像 `sha256:1ea6049b183c9a21aa18ed8b06d98c5709265d759411f7c0dcf50dd9400f2666`。
- Provider、Runtime 的容器 ID、镜像与启动时间均未变化；接收会话、目录、账户和数据库保持原状。新 Console 于 18:43:24 启动，ready 返回 200。
- 真实局域网浏览器登录后读取原 Task，刷新恢复查询，四项说明和原代码均可见；移动布局无横向溢出。请求记录只有登录 POST，没有 `/api/commands` POST，也没有页面错误。
- 更新前后对比三个已有 Task 和三个执行对象，六份记录逐项相等，命令账本未变。18:44 归档 running，未确认接收和本地丢弃均为零。

证据：[deploy-console.json](deploy-console.json)、[live-browser.json](live-browser.json)、[no-redispatch.json](no-redispatch.json)。[正式任务详情截图](formal-task-evidence.png)。canonical 与当前部署 env 的 Console 镜像引用已同步；私有凭据没有进入仓库。

## 接收端仍待核实

实际三份模式帧的 sender=0、target=1，标准 2.1 长度/CRC 有效，当前上游源码的参考解码器可接受；验证完全离线，没有额外发送。见 [frame-check.json](frame-check.json)。这只能证明本地编码与该源码一致，不能证明现场进程已经解码或应用。

上游源码仍为 `a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e`。读取现场日志的只读 SSH 被拒绝（退出码 255，Permission denied），已请求 `ros2_zmq_server_sl` 在 **18:23:47–18:23:57** 的 `invalid frame`、`received mode`、`applied mode` 和业务拒绝记录。见 [receiver-access.json](receiver-access.json)。需要这些记录继续区分实际接收、解码和业务应用阶段，当前不宣称导航修复或现场动作通过。

本轮没有修改/重启仿真端，没有变更控制发送合同、自动回退协议、延长模式超时或重派失败任务。主目录和 SDAR 未修改，既有心跳监控保持暂停；没有新增 24 小时稳定性结论。

## 软件验证与命令

| 命令/验证 | 退出码与结果 |
| --- | --- |
| 修改文件 ESLint | 0 |
| Console `typecheck` | 0 |
| TaskEvidence、预览采用、Profile 单元测试 | 0，18 项通过 |
| Console 生产构建 | 0 |
| 隔离 API 的 Playwright 生产页面验证 | 0，1 项；采用一次、刷新不重派、失败与证据分列、移动布局 |
| 固定源码 Console `docker buildx bake` | 0 |
| `deploy-console.py`，Compose `up --no-deps ... console` | 0，ready，写端未重启 |
| `verify-live.mjs`，正式 HTTP 原任务只读浏览器 | 0，无设备控制派发 |
| `inspect-tasks-after.mts`，既有任务与账本查询 | 0，六份记录不变 |

详细命令：[gates.json](gates.json)、[console-build.json](console-build.json)、[deploy-console.json](deploy-console.json)。首次 ESLint 指出代码类型声明使未知证据码分支被错误视为必定存在，已改为 `Partial<Record<...>>` 后全部通过；首轮失败日志在私有证据哈希中保留。此前一次人工只读查询误用 UUID 数组与 text 列比较，数据库以 42883 拒绝；改为 text 数组查询后成功，没有写入。

软件门禁和页面说明已完成，现场模式回显问题仍未关闭。原始私有证据及哈希见 [raw-evidence-hashes.json](raw-evidence-hashes.json)，公开文件校验见 [SHA256SUMS](SHA256SUMS)。
