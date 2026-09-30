# Legacy goal mapping — interim

All 48 UGVB tasks and B01–B36/C01–C12 are mapped below. This is a source/test inventory, not a PASS ledger. The JSON companion preserves each original Given/When/Then, required layer and applicability. A test association does not prove the entire assertion. Current executed results are in VALIDATION.md; all four same-candidate real workflows and selected GOWM qualification remain incomplete. No independent audit or external SDAR acceptance is claimed.

Source package SHA-256: `04b48492310729a1ad4a72e803406b19939993c5b5131db69b111a425358e817`.

## Source and test groups

| Group       | Code / contract                                                                                                                                                                    | Tests                                                                                                                                                          | Convergence                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| BASELINE    | `reports/business-feedback-final-convergence-v1.2/BASELINE.md`<br>`reports/business-feedback-final-convergence-v1.2/REUSE_MATRIX.md`                                               | Assessment / external evidence                                                                                                                                 | BFF-001                                 |
| SOURCE      | `reports/business-feedback-final-convergence-v1.2/DEVICE_SOURCE_MATRIX.md`                                                                                                         | Assessment / external evidence                                                                                                                                 | BFF-003                                 |
| CORE        | `packages/vehicle-provider-core/src/task-business-contract.ts`                                                                                                                     | `tests/contract/task-business-core.test.ts`                                                                                                                    | BFF-021                                 |
| ARTIFACT    | `packages/vehicle-provider-core/src/task-business-artifact.ts`                                                                                                                     | `tests/contract/task-business-artifact.test.ts`                                                                                                                | BFF-021                                 |
| INTERACTION | `packages/vehicle-provider-core/src/task-business-interaction.ts`                                                                                                                  | `tests/contract/task-business-interaction.test.ts`                                                                                                             | BFF-010/BFF-016                         |
| PROFILE     | `packages/adapter-protocol/src/task-business-profile.ts`<br>`apps/ugv-provider-adapter/src/task-business-bootstrap.ts`<br>`apps/ugv-provider-adapter/src/task-business-service.ts` | `tests/contract/task-business-operation-profile.test.ts`<br>`tests/contract/ugv-task-business-config.test.ts`                                                  | BFF-002/BFF-006/BFF-010                 |
| GENERATED   | `scripts/task-business/generate-core-contract.mjs`<br>`scripts/task-business/check-adapter-proto-compat.mjs`                                                                       | `tests/contract/task-business-catalog.test.ts`                                                                                                                 | BFF-021                                 |
| STORE       | `packages/provider-adapter-kit/src/task-business-store.ts`<br>`packages/provider-adapter-kit/src/memory-task-business-store.ts`                                                    | `tests/contract/task-business-memory-store.test.ts`                                                                                                            | BFF-018                                 |
| NATIVE      | `packages/provider-adapter-kit/src/postgres-task-business-store.ts`                                                                                                                | `tests/ugv-business/persistence/task-business-postgres.test.ts`                                                                                                | BFF-018                                 |
| SHARED      | `packages/gowm-shared-storage-adapter/src/task-business.ts`<br>`contracts/gowm-shared-storage/task-business-owner-handoff.sql.template`                                            | `tests/integration/gowm-task-business-open-postgres.test.ts`<br>`tests/integration/gowm-task-business-owner-template-postgres.test.ts`                         | BFF-018                                 |
| EVENT       | `packages/provider-adapter-kit/src/postgres-store.ts`<br>`packages/mcp-protocol/src/task-business-feedback.ts`                                                                     | `tests/contract/task-business-projection.test.ts`<br>`tests/business-events/source/task-business-public-stream.test.ts`                                        | BFF-021                                 |
| COMMAND     | `packages/provider-adapter-kit/src/task-business-commands.ts`                                                                                                                      | `tests/contract/task-business-command-service.test.ts`                                                                                                         | BFF-010/BFF-014                         |
| ADAPTER     | `packages/provider-adapter-kit/src/vehicle-grpc-server.ts`<br>`apps/ugv-provider-adapter/src/task-business-service.ts`                                                             | `tests/contract/task-business-adapter-wire.test.ts`<br>`tests/contract/ugv-task-business-query-service.test.ts`                                                | BFF-021                                 |
| PUBLIC      | `apps/runtime/src/task-business-gateway.ts`<br>`apps/runtime/src/task-business-public.ts`                                                                                          | `tests/contract/task-business-public-wire.test.ts`<br>`tests/contract/task-business-runtime-gateway.test.ts`<br>`tests/e2e/ugv-task-business-read-e2e.test.ts` | BFF-019/BFF-020                         |
| AUTH        | `apps/runtime/src/task-business-gateway.ts`                                                                                                                                        | `tests/contract/task-business-runtime-input-authorization.test.ts`                                                                                             | BFF-010                                 |
| REDUCER     | `packages/mcp-protocol/src/task-business-reducer.ts`<br>`scripts/task-business/read-only-probe.ts`                                                                                 | `tests/contract/task-business-reducer.test.ts`<br>`tests/contract/task-business-read-only-probe.test.ts`                                                       | BFF-019/BFF-020                         |
| NAV         | `apps/ugv-provider-adapter/src/navigation-business-processor.ts`<br>`apps/ugv-provider-adapter/src/navigation-trajectory-processor.ts`                                             | `tests/contract/ugv-navigation-business-processor.test.ts`<br>`tests/integration/ugv-provider-adapter.test.ts`                                                 | BFF-004/BFF-005/BFF-006/BFF-007         |
| RECON       | `apps/ugv-provider-adapter/src/recon-business-processor.ts`                                                                                                                        | `tests/contract/ugv-recon-business-processor.test.ts`                                                                                                          | BFF-008/BFF-011/BFF-012                 |
| FOOTPRINT   | `apps/ugv-provider-adapter/src/footprint-business-processor.ts`                                                                                                                    | `tests/contract/ugv-footprint-business-processor.test.ts`                                                                                                      | BFF-011                                 |
| TARGET      | `apps/ugv-provider-adapter/src/target-business-processor.ts`                                                                                                                       | `tests/contract/ugv-target-business-processor.test.ts`                                                                                                         | BFF-008/BFF-012                         |
| LOCK        | `apps/ugv-provider-adapter/src/native-lock-business-processor.ts`                                                                                                                  | `tests/contract/ugv-native-lock-business-processor.test.ts`                                                                                                    | BFF-008/BFF-009/BFF-012                 |
| AUTO        | `apps/ugv-provider-adapter/src/provider-auto-lock-coordinator.ts`<br>`apps/ugv-provider-adapter/src/runtime.ts`                                                                    | `tests/integration/ugv-provider-auto-lock.test.ts`                                                                                                             | BFF-009/BFF-012                         |
| INPUT       | `apps/ugv-provider-adapter/src/manual-input-business-handler.ts`<br>`apps/ugv-provider-adapter/src/runtime.ts`                                                                     | `tests/integration/ugv-required-input-producer.test.ts`<br>`tests/contract/ugv-manual-input-probe.test.ts`                                                     | BFF-010/BFF-012                         |
| EDIT        | `apps/ugv-provider-adapter/src/runtime.ts`<br>`packages/provider-adapter-kit/src/task-business-commands.ts`                                                                        | `tests/contract/task-business-command-service.test.ts`<br>`tests/contract/ugv-intervention-probe.test.ts`                                                      | BFF-013/BFF-014/BFF-015/BFF-016/BFF-017 |
| MANUAL      | `scripts/task-business/manual-acceptance.ts`                                                                                                                                       | `tests/contract/ugv-manual-acceptance.test.ts`                                                                                                                 | BFF-019                                 |
| HANDOFF     | `docs/integration/ugv-task-business-consumer-handoff.md`<br>`reports/business-feedback-final-convergence-v1.2/SDAR_HANDOFF.md`                                                     | Assessment / external evidence                                                                                                                                 | BFF-020                                 |
| CI          | `.github/workflows/ci.yml`<br>`package.json`                                                                                                                                       | Assessment / external evidence                                                                                                                                 | BFF-021                                 |
| LIVE        | `reports/business-feedback-final-convergence-v1.2/EXTERNAL_BLOCKERS.json`<br>`reports/business-feedback-final-convergence-v1.2/SCENE.json`                                         | Assessment / external evidence                                                                                                                                 | BFF-007/BFF-012/BFF-017                 |
| CLOSEOUT    | `reports/business-feedback-final-convergence-v1.2/DEFINITION_OF_DONE.md`                                                                                                           | Assessment / external evidence                                                                                                                                 | BFF-022                                 |

## UGVB tasks

| ID       | Original task                            | Groups          | Current boundary                                                                                    |
| -------- | ---------------------------------------- | --------------- | --------------------------------------------------------------------------------------------------- |
| UGVB-001 | 接纳本地真实基线并保护已有改动           | BASELINE        | CURRENT_ASSESSMENT_RECORDED; source inventory is not workflow qualification                         |
| UGVB-002 | 识别本地领先能力与等价实现               | BASELINE        | CURRENT_ASSESSMENT_RECORDED; source inventory is not workflow qualification                         |
| UGVB-003 | 盘点南向真实业务来源与缺口               | SOURCE          | CURRENT_ASSESSMENT_RECORDED; source inventory is not workflow qualification                         |
| UGVB-004 | 冻结本轮范围、Profile 和验证层次         | PROFILE         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-005 | 收口 Context 与判别联合合同              | CORE            | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-006 | 固定来源事件与 Runtime 公开事件映射      | EVENT           | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-007 | 空间对象、内容可用性与版本引用合同       | ARTIFACT        | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-008 | 动作、人工输入和可选干预合同             | INTERACTION     | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-009 | 逐 Operation 能力发现与 Profile 业务开关 | PROFILE         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-010 | 生成合同产物并完成正反例门禁             | GENERATED       | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-011 | 业务Store端口与Memory实现                | STORE           | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-012 | Native PostgreSQL业务版本存储            | NATIVE          | BASELINE_NATIVE_IMPLEMENTATION; not selected GOWM qualification                                     |
| UGVB-013 | GOWM共享访问层与结构交接                 | SHARED          | NOT_RUN_SELECTED_STORAGE; owner business installation missing; template component evidence only     |
| UGVB-014 | 原子ChangeSet、业务持久源与提交后通知    | STORE, EVENT    | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-015 | 业务命令账本与语义级幂等                 | COMMAND         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-016 | 对象版本读取、内容引用与归档策略         | STORE, ARTIFACT | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-017 | Adapter Proto、Gateway 与能力合同扩展    | ADAPTER         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-018 | Adapter 查询服务与 UGV 装配挂接          | ADAPTER         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-019 | Runtime Task绑定、权限与业务网关         | PUBLIC, AUTH    | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-020 | 业务事件摄取、绑定与公开回传             | PUBLIC, EVENT   | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-021 | 公开业务查询与无遗漏快照接续             | PUBLIC          | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-022 | SDAR式纯Reducer与只读消费探针            | REDUCER         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-023 | 导航真实计划与有效引用投影               | NAV             | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| UGVB-024 | 实际轨迹、导航归档与第一条纵向闭环       | NAV             | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| UGVB-025 | 观察区域、扫描安排与覆盖结果投影         | RECON           | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-026 | 当前观察范围与坐标/来源说明              | FOOTPRINT       | MAP_FULL_DISABLED_NOT_QUALIFIED; synthetic geometry tests only                                      |
| UGVB-027 | 多目标发现、稳定ID与多表达               | TARGET          | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-028 | 目标丢失、重现与连续轨迹                 | TARGET          | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-029 | 设备原生视觉锁定动作与阶段回传           | LOCK            | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-030 | 按Profile补受限观察子动作协调            | AUTO            | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-031 | 扫描连续性、任务结束与观察纵向门         | RECON, LOCK     | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-032 | 真实决策点生成RequiredInput与等待策略    | INPUT           | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-033 | 泛化 UpdateExecution 回复路由            | ADAPTER, INPUT  | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-034 | Runtime输入回复、角色与语义守卫          | AUTH, COMMAND   | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-035 | 输入失效、超时、dismiss与状态恢复        | INPUT           | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-036 | 阻塞式输入公开闭环测试与消息样例         | INPUT, PUBLIC   | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| UGVB-037 | 非阻塞Intervention入口生命周期           | EDIT            | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| UGVB-038 | 非阻塞命令公开入口与原子受理             | PUBLIC, COMMAND | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-039 | 真实重规划、采用与有效Mission切换        | EDIT, NAV       | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| UGVB-040 | 目的地与观察区域调整的一致性             | EDIT, RECON     | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| UGVB-041 | 应用失败、迟到结果与连续调整             | EDIT            | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| UGVB-042 | 运行中计划调整公开闭环门                 | EDIT, PUBLIC    | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| UGVB-043 | 选定Profile资格与关闭回归                | PROFILE         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| UGVB-044 | 受影响新旧回归与持久化门                 | CI, SHARED      | NOT_RUN_SELECTED_STORAGE; owner business installation missing; template component evidence only     |
| UGVB-045 | 受控真实仿真四条业务链验收               | LIVE            | NOT_RUN; same-candidate real workflows absent                                                       |
| UGVB-046 | SDAR消费交接与消息示例                   | HANDOFF, MANUAL | EXTERNAL_PENDING; no same-candidate real SDAR samples                                               |
| UGVB-047 | 独立设计与实现审计                       | CLOSEOUT        | NOT_COMPLETE; four workflows, selected storage and independent audit remain open                    |
| UGVB-048 | 最终收口、状态声明与可恢复交付           | CLOSEOUT        | NOT_COMPLETE; four workflows, selected storage and independent audit remain open                    |

## Business and contract assertions

| ID  | Original assertion | Groups                | Current boundary                                                                                    |
| --- | ------------------ | --------------------- | --------------------------------------------------------------------------------------------------- |
| B01 | 真实导航路线       | NAV                   | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B02 | candidate与adopted | NAV                   | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B03 | 多导航模式         | NAV, ARTIFACT         | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B04 | 实际轨迹更新       | NAV                   | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B05 | 路线不可用         | NAV, ARTIFACT         | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B06 | 任务结束           | NAV, STORE            | COMPONENT_ONLY; real planned route/adoption and V-NAV missing                                       |
| B07 | 观察四种区域       | RECON, FOOTPRINT      | MAP_FULL_DISABLED_NOT_QUALIFIED; synthetic geometry tests only                                      |
| B08 | 覆盖统计与几何     | RECON                 | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B09 | 估算视场           | FOOTPRINT, ARTIFACT   | MAP_FULL_DISABLED_NOT_QUALIFIED; synthetic geometry tests only                                      |
| B10 | 发现多个目标       | TARGET                | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B11 | 仅像素目标         | TARGET, ARTIFACT      | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B12 | 目标丢失与重现     | TARGET                | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B13 | 设备原生锁定       | LOCK                  | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B14 | Provider局部策略   | AUTO                  | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B15 | 锁定阶段           | AUTO, LOCK            | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B16 | 恢复扫描           | RECON, INPUT          | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B17 | RequiredInput      | INPUT, AUTH           | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B18 | 非人工默认模式     | LOCK, INPUT           | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B19 | 人工输入失效       | INPUT, COMMAND        | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B20 | 等待超时/拒绝      | INPUT                 | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| B21 | 干预入口存在       | EDIT                  | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B22 | 高频更新与人工调整 | COMMAND               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B23 | 有效计划已变       | COMMAND               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B24 | 实际重规划采用     | EDIT, NAV             | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B25 | 重规划失败         | EDIT                  | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B26 | 连续两次调整       | EDIT                  | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B27 | 目的地/区域改变    | EDIT, NAV, RECON      | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B28 | 取消后迟到规划     | NAV, EDIT             | GENERIC_COMPONENT_ONLY; UGV running intervention still rejected; route/replan source missing        |
| B29 | 快照/流重叠        | PUBLIC, REDUCER       | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B30 | 同Context多条消息  | REDUCER               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B31 | 精确版本内容       | ARTIFACT, STORE       | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B32 | 相同command重试    | COMMAND, SHARED       | NOT_RUN_SELECTED_STORAGE; owner business installation missing; template component evidence only     |
| B33 | 作用域隔离         | STORE, PUBLIC, SHARED | NOT_RUN_SELECTED_STORAGE; owner business installation missing; template component evidence only     |
| B34 | 业务关闭           | PROFILE               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| B35 | 共享存储           | SHARED                | NOT_RUN_SELECTED_STORAGE; owner business installation missing; template component evidence only     |
| B36 | 非目标Provider回归 | ADAPTER, CI           | LOCAL_CHECKS_ONLY; selected persistence and final candidate CI not qualified                        |
| C01 | 判别联合           | CORE                  | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C02 | availability条件   | ARTIFACT              | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C03 | 空间表达           | ARTIFACT              | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C04 | 游标域             | PUBLIC, REDUCER       | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C05 | 同版本业务摘要     | REDUCER               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C06 | 语义guard          | COMMAND               | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C07 | 人工身份           | AUTH                  | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C08 | 输入取消含义       | INPUT                 | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
| C09 | 可信外层           | EVENT, PUBLIC         | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C10 | 协议兼容           | ADAPTER, GENERATED    | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C11 | 内容可读           | ARTIFACT, PUBLIC      | BASELINE_COMPONENT_MAPPING; see validation logs, no live qualification inferred                     |
| C12 | 回传非命令         | REDUCER, LOCK         | INFERRED_CURRENT_EXECUTION; real public V-OBS/V-INPUT PASS; overall final-candidate Goal still open |
