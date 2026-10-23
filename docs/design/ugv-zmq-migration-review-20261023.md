# ZMQ 迁移设计复核记录

日期：2026-10-23。被审查文档：[迁移设计](./ugv-zmq-migration-20261023.md)。源码基线：`d26002f127a4152ee1dc034950501be2f182b6ea`。

发现 7 项需要补正的设计遗漏：6 项 P1，1 项 P2。已将修正决策和 G0～G6 验收条件写入迁移设计。这里的“已补正”指设计文档，相关代码及上游协议保证尚未实现或验收。本次仅编辑设计资料。

审查前版本已固定于 `/mnt/data/ugv-zmq-migration-20261023/review/design-before-review.md`，SHA-256 为 `cd43e073b1ce1ac955c4f4c6c9e14d3ba3e82cd1be78798dd270b3a9913ea9de`。

## R1 · P1：新增驱动缺少匹配的启动 profile 和完整操作注册链

原计划列出驱动与目录改造，但没有明确现有业务 profile 的启动依赖。当前 profile 开启 Provider 视觉锁定、人工决策、机场估计足迹和导航调整；如果迁移中停用 7879 而保留该配置，启动验证会拒绝。即使服务勉强启动，也可能继续尝试 ZMQ 没有对应合同的旧锁定流程。

另一个具体阻断点是 Runtime 的操作集合取自 `UGV_OPERATION_TRACKS`；只在 manifest 中加入新仿真工具不构成可执行能力。面板也有专用工具白名单。

证据：[当前业务配置](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/deploy/development/server/profiles/ugv-business.json:4)、[启动验证](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-provider-adapter/src/task-business-bootstrap.ts:34)、[操作集合](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-provider-adapter/src/runtime.ts:176)。

已补正：新增 ZMQ 专用业务 profile，明确无新合同的功能配置；把注册、资格、占用、启动校验、结果合同、TaskBusiness、面板入口列为闭环工作项。G1 要求用正式 MCP 创建并执行任务，不能以目录可见代替。

## R2 · P1：迟到效果结果在冻结业务合同内没有合法写入位置

原计划承诺北向任务结束后继续追加版本化业务对象。当前 ArtifactType 是固定的空间对象集合，structured 效果报告也会被校验拒绝。Context finalized 后，PostgreSQL 存储又禁止后续 Context/对象写入。直接实现原描述会在最需要恢复的超时/迟到场景失败。

证据：[Artifact 类型](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/vehicle-provider-core/src/task-business-artifact.ts:162)、[structured 内容拒绝](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/vehicle-provider-core/src/task-business-artifact.ts:460)、[Context 完成后写入限制](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/provider-adapter-kit/src/postgres-task-business-store.ts:690)。

已补正：普通效果摘要使用新工具结果、Context summary 扩展及受约束事件数据；迟到反馈保存为 Provider 独立附加结果记录，发布候选查询工具 `simulation_get_effect_result`。原任务及已 finalized 的 Context 保持终态，查询沿用原完整执行身份，独立占用按实际结束证据解除。G2 增加 Context 已归档后迟到结果仍可查询的反例。

## R3 · P1：执行域切换会改变面板历史分区，仿真 reset 缺少运行身份规则

原计划指出需要 simulation 域，但没有给出面板、Provider 和消费者同步迁移规则。面板只配置一套全局执行头，并以 MCP 地址和上游头计算 domain；任务/命令查询按该 domain 过滤。直接从 live 改 simulation 后，旧记录仍在数据库，却不会出现在新域列表。新场景 reset 若继续复用同一 simulationId，还可能混入旧观测或未决结果。

证据：[执行头和 simulationId](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/config.ts:48)、[domain 生成](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/config.ts:91)、[任务查询分区](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/store.ts:131)。

已补正：首版采用统一单执行域部署，显式同步 simulationId；新场景/reset 使用受控运行身份，网络重连不更换场景。旧域保留经授权的只读历史路径和原合同解码。对服务端没有场景代次的情况明确依赖可信编排通知，不能自行声称已检测 reset。

## R4 · P1：停止优先队列不能抢占已经运行的长等待

原计划保留任务调度，但未规定 ZMQ 等待在哪里发生。当前 MutationQueue 在全局 drain 中 await 当前工作，优先控制只能越过未开始的工作。如果驱动把模式回显、动作完成或数据库长等待放进去，停止会被阻塞；旧等待返回后还可能继续发送 START。REQ 单次收发约束也禁止用同一 socket 直接插入停止。

证据：[全局等待点](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-provider-adapter/src/mutation-queue.ts:51)、[自驾模式与启动规则](/home/sz/Documents/zmq/自驾ZMQ对接协议.md:84)、[REQ 及停止预算](/home/sz/Documents/zmq/光电ZMQ对接协议.md:71)。

已补正：拆分持久阶段、有界发送与观测唤醒，取消后使后续步骤失效；分别测量控制调度与停稳监督时延。对协议允许的模式同值重试单独建策略，避免“一律不重发”又违背自驾重试合同。G3 覆盖长等待、REQ 超时、数据库积压和 stop 后旧等待返回。

## R5 · P1：覆盖比例转换可能抹掉显式未完整/未知证据

原计划正确指出源流完整性不足，但没有定义覆盖完整标志的规范化规则。ZMQ 同时提供比例和三态 `coverage_complete`；现有检查结果只要 coveragePercent=100 且 incomplete 不为 true，就视为完整。若新驱动只转换比例并遗漏 false/null 标志，会继续生成误报完整的结果。

证据：[ZMQ 覆盖三态](/home/sz/Documents/zmq/光电ZMQ对接协议.md:598)、[旧完整判断](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-provider-adapter/src/inspection-report.ts:141)。

已补正：保留比例、完整声明、来源时间及任务关联；按签定判据处理矛盾，false/null 不被 100% 覆盖。设备 ready、任务 completed、面积覆盖与识别流完整分别判断。G4 明确加入 ratio=1 且 complete=false/null、采集时间空、截断、漏收和跨任务迟到。

## R6 · P1：切换与回退缺少发送者交接和旧依赖可用条件

原计划要求无未决动作后切换，却没有定义未决动作长期未知、旧发送者仍可能发包时如何处理；也默认恢复旧镜像/配置即可回退。用户已明确旧接口过时，不能据此保证提供方仍保留该服务。双实例交接和回退读旧合同都需要实际方案。

证据：审查前设计第 186～187 行；[已固定的审查前版本](/mnt/data/ugv-zmq-migration-20261023/review/design-before-review.md:186)。

已补正：停止旧准入、对账独立未结占用、冻结传输与合同绑定、交接唯一发送者；租约不能冒充设备端 fencing，也不能撤回在途消息。未知占用未解除则禁止提升新控制端。旧接口不可用时，回退目标限定为撤回目录、禁派、诊断和保留历史，恢复控制需上游服务恢复。G6 验证这些分支与历史解码兼容。

## R7 · P2：100Hz 接收存档缺少容量、保留及原始帧取回方案

原计划只要求压测，未给容量基线和耗尽行为。100Hz 单车每天是 864 万条记录；按协议定宽字段计算，定位单帧为 248 字节，原始帧已约 2.14GB/天，数据库及索引额外增长。仅存哈希和引用不能证明原始帧可读取；直接删旧记录也会影响既有链式证据。

证据：[定位字段及类型](/home/sz/Documents/zmq/自驾ZMQ对接协议.md:145)、[现有接收记录合同](/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/trajectory-history/src/contract.ts:70)、[计算记录](/mnt/data/ugv-zmq-migration-20261023/review/review-input.json)。该估算为定宽原始帧字节推导，不是实测存储性能。

已补正：原始帧可读持久存储、分帧摘要、队列/磁盘预算、保留区间、归档校验和耗尽处置进入实施范围；本地可观测丢弃与上游未知连续性分别表达。G5 验证负载、故障恢复、原文取回和历史签名。

## 验证及剩余前提

本次对照了本地三份协议与上述源码路径，保存审查前文本及计算依据，并校验 Markdown 格式。没有运行设备控制或把审查当成功能测试。

仍需提供方解决的前提包括自驾反馈关联、设备启动/场景代次、历史/完整报告补取、时间坐标语义和有效能力档案。计划已明确：禁用或降级的能力计为未完整交付，不能凭 partial/unknown 报告把完整导航恢复、完整巡检或跨重启恢复标为通过。
