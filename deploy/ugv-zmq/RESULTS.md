# ZMQ 检查成果与仿真效果（第四阶段）

第四阶段在 `vehicle-zmq-control` 提供可执行的隔离实现和面板候选合同。所有控制仍要求 `isolated_simulator`、六个数字 loopback 端点及明确的模拟身份。19100/19101 与提供方端点未切换。正式 MCP/TaskBusiness/SDAR 发布、GOWM 存储路由和部署交接属于第五阶段；G0 仍未通过。

## 检查

`inspection.area` 复用区域侦察的资格、EO 互斥、配置、启动、暂停、恢复、取消、期限及恢复链，持久身份独立保留。它要求四个严格凸 WGS84 顶点及逐点明确的椭球高；不静默把二维任意多边形改成四边形，不默填高程，不支持排除区。总预算最多 300 秒。

确认写入观测档案后，按完整执行身份、原生任务、设备、接收会话及来源版本积累有效目标/跟踪帧和覆盖声明。历史任务、过期/回放、重复/冲突、外来设备和无法关联的帧不进入成果。采集时间未知时保留 null；像素检测没有猜测位置。跟踪项保留地理位置及测距来源。帧内 ID 不作为跨帧实体 ID，数量是逐帧观测项数。

内联最多 256 项，所有接受的源报告另存为可分页读取的 Provider JSONB 记录。结果分别保留内联截断、源端截断、未知采集时间、覆盖比例与三态完成声明。比例 1 不覆盖 false/null；矛盾声明明确标注。空帧只表示该已收帧没有发现。现有协议不能证明任务级识别流完整，缺少覆盖足迹及任务轨迹，因此结果明确为 partial/unavailable，不产生完整巡逻成功。

成果投影队列有界，溢出/写入未确认产生明确缺口，原始接收档案仍独立留存。其后查询可从已提交结果版本重建落后的摘要头；单次重建有界，超限提示使用分页，不能把重建不全标成完整。

## 仿真效果

`simulation.applyEffect` 只接受当前仿真检查任务中、同资源/授权域/场景/接收会话的有效地理跟踪报告引用。请求固定源任务、执行 ID、版本、目标及位置快照；发送前再次核实采集新鲜度。不能手填任意目标坐标替代来源。TaskExecution 时序与原请求身份持久保存；一次交互只派发一次 `AttackTarget`。该线路方法名及 `artillery-01` 是冻结兼容字段，界面使用仿真术语。

REP accepted、任务执行结果、`execution_finished` 与 hit/miss/destroyed/unknown 分开保存。受理后没有暂停、恢复和取消接口。平台超时或停止等待不会撤销动作，尚未结束的占用继续保留。结束反馈还需新鲜 idle/ready 状态才释放。回执丢失可在同接收会话中从原 request_id/task_id 关联 PUB，禁止重派。

迟到结果写入独立、带完整身份和来源引用的附加版本。原任务终态、原因、结果以及 finalized Context 不修改。已结束但效果未知的记录也能接收后续已知效果。来源中断或进程重启缺乏设备 boot/session 证明时保留未知与占用，不借相同原生 ID 自动对账、控制或重放。位置/请求关联冲突保持隔离。

## 存储与查询

复用 `ugv_state_snapshot.snapshot` 保存 `ugv.zmq-result-record/1`，不新增表、不修改冻结迁移。记录键由完整身份与来源引用摘要生成，同键不同内容拒绝；写入按身份串行分配递增 revision。内容摘要、完整身份、源引用和接收时间随记录保存，读取核实摘要。现阶段仅支持第三阶段的独立 Provider 存储，不能直接接入当前联合部署数据库。

引擎接口：`results`、`inspectionResults`、`effectResults`。查询核对 Provider、资源、taskId、真实 executionId、操作、scope、授权域、executionMode 和 simulationId；只返回平台留存来源。每页最多 8 条、约 900 KB；大报告可继续分页。面板整体导出有 24 MiB/512 页上限，超限明确返回继续分页的入口。

完整参数预检使用异步 `checkAvailability`，包含仿真观测身份、版本、新鲜度及位置快照核实；同步 `availability` 仅用于组件健康/占用。派发仍独立复核。附加结果的当前缺失证据会消除已由有效反馈补齐的缺口，原任务结果中的历史缺失证据保持原值。

## 面板候选合同

| 候选工具                        | 行为                                                        |
| ------------------------------- | ----------------------------------------------------------- |
| `vehicle_zmq_inspect_area`      | 四点凸区域、明确椭球高、识别/自动跟踪策略；可暂停/恢复/取消 |
| `simulation_apply_effect`       | 从有地理来源的当前观测中选择；不支持暂停/恢复/取消          |
| `vehicle_get_inspection_result` | 已导入检查任务的摘要和报告分页                              |
| `simulation_get_effect_result`  | 原任务结论、当前独立占用、最新附加结果和历史分页            |

`shared/zmq.ts` 提供候选 Schema/Profile，`operationFromConsoleCandidate` 确定性转换为引擎操作。面板核对完整输入 Schema、`io.sdar/ugvZmq` 版本和 Task Profile；仅在服务端固定 simulation 域及 simulationId 下启用。未知/缺失/变化合同拒绝。浏览器不设置上游地址、凭据或执行域。旧目录仍按旧合同解码，未发布候选保持禁用。切换部署域时必须按第五阶段保留经授权的旧域只读访问。

任务详情定时读取附加结果，即使原任务已终止；分页、报告导出核对执行身份、递增游标与内容摘要。ZMQ 观测 V2 单独显示通道接收新鲜度和资格缺口，不生成 MQTT 在线状态或虚构覆盖图。

## 隔离验证

```bash
pnpm test:ugv-zmq-control
SMPP_ZMQ_TEST_CONFIG_FILE=/private/isolated-postgres.json pnpm test:ugv-zmq-control:postgres
SMPP_ZMQ_TEST_CONFIG_FILE=/private/isolated-postgres.json pnpm test:ugv-console:zmq
```

临时 PostgreSQL 配置及凭据仅存私有文件。浏览器夹具使用 127.0.0.1:19106、真实 ZMQ PUB/SUB/REQ/REP 和 PostgreSQL，MCP 桥为测试适配器；它不是正式 Runtime/TaskBusiness 发布验收。模拟裁判使用测试世界的距离/半径及健康值计算结果，并注入失败、未知、迟到和回执丢失；没有提供方 ROS/CARLA 实现的验收证明。证据见 `reports/ugv-zmq-phase4/`。
