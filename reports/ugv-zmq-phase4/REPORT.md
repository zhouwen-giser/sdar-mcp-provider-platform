# ZMQ 第四阶段验收记录

## 结论

检查成果、仿真效果任务/附加结果查询和控制面板候选接入已完成隔离实现。**207 项测试通过**：ZMQ 合同/观测/控制及真实 PostgreSQL 146 项，面板 56 项（含原 MCP/MQTT Runtime 集成 6 项），旧面板浏览器 4 项，原生 ZMQ 面板浏览器 1 项。针对最终预检与证据导出的复测也已通过。42 条验证命令均达到预期退出码。

这是隔离交付，正式 Runtime/TaskBusiness/SDAR 发布、GOWM 路由、现场资格和部署交接进入第五阶段。G0 仍有 12 项待确认，预检按预期返回 2，`runtimeAdmission=not_published`。测试没有向 192.168.2.63 派发命令，运行实例镜像保持原值。

清理后核对发现现有适配器的启动时间发生变化；原因未核实，本阶段没有发起其重启或更新命令。Runtime 和面板启动时间保持原值。现场稳定性仍需单独核查，详情见 `raw/cleanup.json`。

## 固定源码与环境

- 基线：`9b870691e6a26eb6ee0193a1b10a5ab40b95bc6e`；交付分支：`codex/ugv-zmq-phase4-20261024`。
- 源码以本报告所在的交付 commit 及 `source-manifest.json` 文件摘要为准；最终 commit/远端回执另存于本地 delivery receipt。
- Node 22.23.2、ZeroMQ.js 6.8.0 / libzmq 4.3.5、PostgreSQL 17.10，Linux x64。镜像 ID 及运行实例快照见 `raw/environment.json`。
- 使用临时 loopback PostgreSQL、原生 ZMQ 模拟器；旧链路回归另用临时 MQTT。配置/凭据在私有 0600 文件中，不随报告交付。临时环境销毁记录见 `raw/cleanup.json`。

## 已验证的实现

| 范围      | 结果                                                                                                                                  |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 检查      | 四点严格凸 WGS84 区域及明确椭球高；复用 EO 生命周期；按任务、设备、接收会话、来源版本隔离，过滤历史/过期/重复/冲突来源                |
| 成果      | 逐帧发现及有效空帧、未知采集时间、源端截断、三态覆盖声明分别保存；内联 256 项，全部接受的报告另行分页读取                             |
| 完整性    | 空帧不证明全任务无发现；覆盖比例 1 不覆盖 false/null；识别流、覆盖足迹和轨迹缺口明确降级                                              |
| 仿真效果  | 当前地理观测来源/版本/位置快照；完整参数异步预检及派发前复核；一次 REQ；执行结果、是否结束、裁判效果独立                              |
| 迟到/恢复 | 超时仍保留未结束占用；迟到版本可释放独立占用，原终态/结果保持不变；重启/来源中断后保持未知且不重派                                    |
| 存储      | 复用 Provider JSONB 快照；完整执行身份、递增版本、不可变来源键与内容摘要；无新增表及冻结迁移修改                                      |
| 面板      | 精确 Schema/Profile/版本与 simulation 域检查；四点/高程表单、当前地理观测选择、附加结果定时查询、分页与报告导出；不支持的控制保持禁用 |
| 隔离      | 控制端点全部 numeric loopback；现有部署、主检出的联合打包修改、原协议和历史解码保持隔离                                               |

## 证据链

`verification.json` 保存每条命令的 argv、cwd、开始/结束时间、实际/预期退出码及日志 SHA-256。原始日志按 gzip 原字节保存，并记录解压后摘要。完整回归后另行验证了：当前与历史缺失证据、来源过期/位置不匹配预检、浏览器优雅退出归档以及报告导出。

- 最终原生结果批次：8 个接收会话，893 条档案项、821 次接收；18 个结果版本的摘要及来源引用全部核实。
- 浏览器最终批次：见 `raw/logs/native-browser-prechecked-verifier.log.gz`；同时保存完整原始接收链、任务/命令/结果版本及实际下载报告。早一轮浏览器导出也单独保留。
- 既有控制回归：27 个会话，2667 条档案项、2433 次接收，81 个最终控制来源引用全部核实。
- `raw/results*.json`、`raw/browser*-results.json` 保存原生命令、执行及结果快照；`raw/*receptions*.ndjson.gz` 保存准确多帧字节、逐条摘要、会话链头/链尾。两种截图保存桌面/手机展示。

浏览器验证了：选择真实接入夹具的当前地理观测、一次仿真请求、1 秒平台期限、迟到的几何判定“虚拟未命中”、独立占用释放、不可取消/暂停、原失败终态保留以及认证后的完整报告下载。界面区分原任务历史证据与附加版本当前证据。

模拟裁判按测试世界的距离/半径和健康值计算 hit/miss/destroyed，另注入 failed/unknown、回执丢失和迟到反馈。它不是提供方 ROS/CARLA 实现，也没有完成真实设备或正式治理目录验收。

## 复现与后续

实现与命令说明：`deploy/ugv-zmq/RESULTS.md`。私有临时 PostgreSQL 配置可运行 `test:ugv-zmq-control:postgres`；`test:ugv-console:zmq` 启动 127.0.0.1:19106 的测试 MCP 桥。该桥用于隔离验收，不是正式 Runtime。

离线核验示例：

```bash
node dist/scripts/ugv-zmq/verify-control-evidence.js reports/ugv-zmq-phase4/raw/result-receptions-final.ndjson.gz reports/ugv-zmq-phase4/raw/results-final.json
node dist/scripts/ugv-zmq/verify-control-evidence.js reports/ugv-zmq-phase4/raw/browser-accepted-receptions.ndjson.gz reports/ugv-zmq-phase4/raw/browser-accepted-results.json
```

第五阶段需装配受治理的候选目录、MCP/TaskExecution/TaskBusiness、SDAR、存储 owner 路由与旧域只读历史，补齐提供方身份/时间/限值/实现证据，完成单写入者交接后才能生成并切换正式部署。现场执行与回退验收继续单独记录。
