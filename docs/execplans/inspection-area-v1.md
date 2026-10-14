# 区域检查与巡逻接入 ExecPlan

## Purpose / Outcome

实现 SMPP `vehicle_inspect_area` 与 SDAR `embodied.inspect_area`，使区域巡逻可解析检查依赖，并汇总真实任务范围内的发现、覆盖及缺失证据。用户已授权双仓库实现、隔离验证、打包与本地只读部署验收；现场巡逻执行单独记录。

## Requirements Covered

INSPECT-01：WGS84 区域合同和派发前验证；INSPECT-02：有限一次扫描与原生任务控制；INSPECT-03：持久、关联、去重的发现与空报告；INSPECT-04：完整性和覆盖门禁；INSPECT-05：SDAR 治理及巡逻组合；INSPECT-06：隔离正式流程、交付与现场只读验收。

## Context and Orientation

SMPP 复用已附加工作树及轨迹历史实现，基于 cfda8c7f；SDAR 使用独立工作树，基于 4112a90b，并纳入原仓库 b5125688 与 ac7838da 的交付收尾和深层联合包校验修复。保留原仓库的冻结门禁和本地配置。现有侦察使用 area.polygon 经纬度和 TaskBusiness 对象；SDAR 巡逻使用 area.boundary x/y 和 anomalies 输出。

## Architecture and Interfaces

新增默认关闭的 UGV_INSPECTION_ENABLED 和 TASK_REQUIRED 工具 vehicle_inspect_area。输入 resourceId、area.boundary，x=经度、y=纬度，frame 仅 WGS84/EPSG:4326；无效区域及未解析排除区在派发前拒绝。一次扫描、300 秒默认预算。共享侦察操作分类，但执行、Context 和事件保留新操作名。已有 JSONB 与 TaskBusiness 持久事实，不增加表或改冻结迁移。

结果包含 anomalies、inspectionReport、coverage、correlationStrength、missingEvidence。发现项只使用 JSON primitive 字段；内联上限 256，完整业务对象仍可读取。目标来源缺失不能作为无发现证明；覆盖不足、截断或事实冲突保留不完整结果。

SDAR 新增精确 13/14 工具目录配置、同名 Skill/Capability，绑定目录、资源、Provider 和 Task Profile。后继巡逻版本传递 resourceId、area、timeWindow；派发器沿用确认、禁止重放、native continuation 和结果归档。

## Progress

- [x] 2026-10-14 核对原代码、运行配置、引用任务及用户的范围选择。
- [x] 实现 SMPP 区域合同、共同 EO 执行和持久报告。
- [x] 实现 SDAR 适配、治理和巡逻后继版本。
- [x] 2026-10-14 隔离 MQTT、设备 MCP、真实 PostgreSQL 与双项目正式流程验收；八场景 joint-60 通过。
- [ ] 完整门禁、固定源码交付、本地只读发布与回退验证。

## Discoveries and Surprises

SDAR 原工作树仍在运行冻结门禁，因此实现隔离到新工作树。SMPP 执行记录的 operation_name 为 text，payload/result 为 JSONB，可保留新操作及报告而不修改 DDL。原目标、覆盖、锁定和控制处理器多处限定 vehicle_area_recon，需一致使用共同操作分类。

真实 PostgreSQL/MQTT/HTTP Device MCP 验证了 RequiredInput、暂停/恢复/取消、超时、迟到完成与重启后不重派。正式 MCP→gRPC→Adapter 链验证完整、有发现、来源缺失和部分覆盖，原始回执 public-05 为 PASS。完整门禁第一轮通过格式、lint、类型、构建、镜像与其余 322 个单元断言，因旧清单断言尚未纳入检查工具失败；该断言已按新增合同更新。后续 gate-11 已通过完整门禁（exit 0，源码 2ab531b7），包含 325 单元、369 合同、524 集成、9 恢复、55 安全及 10 端到端断言；39 项已有外部设施 opt-in 用例保持原跳过策略。新增检查测试全部实际执行，一致性与容量阶段通过。

2026-10-14：报告补充 inspection.report 真实证据及失败/取消事实保留；目标及覆盖在终态转换前等待原始包持久化，避免快速轮询先于覆盖投影。采用区域后无版本计数明确降级。真实联合测试发现模拟 Device MCP 的初始闲置状态、设备查询和 MQTT 状态不同步，以及错误导航主题；已用仅父进程 IPC 的同 mission 观测同步和正式 mission_state 主题修正。原有公共 PostgreSQL 测试刷新当前模拟设备观测，保留 mission 所有权；public-regression-09 的 4 项通过。完整门禁须传入检查隔离配置并与联合测试顺序运行；gate-09 的配置缺失、旧测试观测过期及变更中源码回执保留为失败记录。

正式双项目链已验证完整、发现、缺来源和部分覆盖检查，以及完整、降级、业务失败巡逻。巡逻的位移子任务保留至少两个真实 MQTT 位移点；单个最终位置正确降级。SDAR 子任务采用独立 Task/Goal/Capability/确认，并在同一事务关闭确定性接收尝试，防止准备恢复队列抢占。连续子任务确认保留同一 continuation 链的递增版本。业务错误 details 在 PostgreSQL 读取中完整保留，父巡逻可以汇总失败而不物理重派。正式 joint-60 已通过全部四个检查和四个巡逻场景、治理重复发布；失败巡逻保留 1 项已观察发现。每次巡逻恰有两个独立子 Task，每个仅一条远端接入记录。取消保留已观察轨迹与缺失区域。原生子 Skill 的完成投影保留降级状态。当前 224 个 SMPP 冻结资产及 165 个 SDAR 冻结资产哈希均未变。

## Decision Log

用户确认双项目闭环；发现口径为当前任务关联的侦察目标和事件；第一版仅 WGS84 和已处理排除区的合法子区域。异常报告不引入视觉模型或地图解析服务。未判定与部分覆盖必须可见。

## Implementation Steps

1. 生成独立合同模块、输入归一化、开关及 manifest。
2. 统一侦察操作分类并接入原生设备资格、互斥、命令日志、控制与业务投影。
3. 持久记录本任务目标报告、覆盖与例外，生成终态有限报告和可读取来源引用。
4. 接入 SDAR 目录、Skill/Capability、时序适配及巡逻后继组合。
5. 使用隔离设施跑正式任务及故障案例；按仓库门禁运行完整验证。
6. 固定源码、打包并校验；确认实例空闲后更新本地镜像与目录，保留绑定、数据卷、密钥及 PMS。

## Validation

逐项记录实际命令、退出码、源码与日志 SHA。覆盖坐标/多边形/排除区/期限；有目标、空报告、缺来源、部分覆盖、截断、重复、迟到、跨作用域；暂停/恢复/取消/超时/RequiredInput/重启不重派；SDAR 完成、降级、失败与取消聚合。旧工具、冻结 MCP/TaskBusiness/BusinessEvents、轨迹历史和存储合同须回归通过。SDAR 每个可运行里程碑执行 AGENTS.md 要求门禁。

## Idempotence and Recovery

相同任务复用原命令日志与受限 Scope；消息版本冲突保留诊断。治理使用正式版本化 API，不覆盖已发布版本。部署保留旧镜像与私有配置；回退撤回新增发布、恢复旧目录配置并关闭开关，保留报告、版本历史、卷和密钥。

## Artifacts and Evidence

reports/inspection-area-v1 保存基线、真实命令回执、测试、门禁、交付及本地验收。发布包不包含私有连接、密钥或现场目标内容。公开合同附示例与验收矩阵。

## Outcomes and Retrospective

双项目核心实现及八场景正式联合验收已完成。SMPP 完整门禁 gate-11 已通过；SDAR 完整门禁、联合包与本地部署继续实施。报告与原始命令回执见 reports/inspection-area-v1；现场设备执行为 NOT_RUN。

## 2026-10-14 最终实现验证

SMPP gate-11 日志 SHA256 `1a019b426c3ec5419a4b5d464cb7b1a2bce0bda3a19b5bf2cd6b88686b23e1ee`。SDAR joint-60 日志 SHA256 `0d93163da3621555c50ec9d8f0e94dcaa2f20b9cc333db5b56a5dc3b2c72327e`，固定 SDAR 源码 `8f97a9f7ff95529c9aa0ed00fc0a4a448d2cb4b57235d785794c2b1abd497fa0` 和 SMPP 源码 `2ab531b7502ea7851c17e07963991f38365a5a8ce766f8e172315c6135b9622a`。全部命令均 exit 0，运行期间两仓库源码未变。224 个 SMPP 冻结资产及 165 个 SDAR 冻结资产最终哈希未变。门禁后的本文更新仅为验收状态，运行源码另以 RUNTIME_SOURCE_LOCK.json 固定。
