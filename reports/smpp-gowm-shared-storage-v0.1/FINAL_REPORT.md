# SMPP → GOWM 共享业务存储交付

状态：**INTEGRATION_DEV_READY**。源码、实际 PostgreSQL 和双设备源码链路分别通过。本报告描述开发接入能力，不表示现有服务已切换或任务包所有扩展测试场景均已执行。

## 来源与改动范围

- SMPP 基线：`b974471dd62665721a5edcc63b7651d2f476160d`；分支 `codex/smpp-gowm-shared-storage-integration-v0.1`。
- 已读取用户引用的 GOWM 任务。消费来源为 `codex/gowm-device-shared-business-storage-v0.2` / `48cebb862e992579b801590385b4373b10422d52`；实际迁移、overlay、helper 按读取时的文件哈希固定在 `contracts/gowm-shared-storage/current/source.json`，包含 core 078、32 个 SMPP/UGV 原生安装条目及三个 overlay。GOWM 工作树存在其他任务的持续变更，不能把当前全部未提交内容当作本次消费的版本。
- 任务包已解压阅读；31 个清单文件校验通过，见 `intake-verification.json`。附件作为需求和验收参考，没有执行附件脚本或其远程发布指令。
- 仅修改 SMPP；没有修改 GOWM/SDAR，没有操纵现有部署或物理设备。

## 实现结果

`SMPP_STORAGE_MODE=gowm-shared` 下，Runtime 和 UGV Adapter 使用同一个显式 GOWM URL，固定 `ugv_smpp,public` search path。启动验证消费表、列、键、函数、trigger、迁移哈希和权限；不执行原生 migration 或 fallback。冲突的旧连接配置、空/多设备集合及错误绑定拒绝启动。单进程只接一台显式登记设备，A/B 用两组实例服务同库。

35 个原生表的消费范围在 `QUERY_ADAPTATION_MATRIX.md` 与 `schema-consumption-matrix.json`。SQL 在调用点显式加入归属过滤和写入字段，没有运行时 SQL 改写器。OperationSnapshot 仍按不可变内容共享；无 device 列的 receipt/uncertainty 继承已限定的父记录。

Admission、Task、Execution 固化 device/binding/service；幂等键增加设备/服务维度，保留授权、mode、simulation 和参数冲突语义。Snapshot 使用 device/source/channel/revision。Event source/游标、outbox、provider_ops、claim、恢复和租约按设备限定；DEVICE 租约使用生成的 `(scope_key,lease_key)`。现有 UGV 入口没有新增 SERVICE 全局作业。

Provider 先写入真实外部 Execution 和回执，MCP UUID 可以迟到。Runtime 发布/恢复通过设备、服务、绑定、Admission、operation、argument hash 和真实 external execution ID 核对并 CAS 补齐关联。发布和关联同事务，不把 Provider taskId 强转为 MCP UUID。

Dispatch 回执与 Mission identity/link 使用同一个 PoolClient 事务；网络调用在事务外。失败整体回滚、同回执重放稳定、内容冲突拒绝。没有可靠设备 session 时使用真实 Execution 范围；A/B 原生编号均为 7 时得到两个 Mission。控制回执写 CONTROLLED，取消不新建 Mission。明确经纬度目标写 EPSG:4326，未知本地坐标保留 NATIVE_ONLY。

TTL 仍令用户句柄到期，共享模式停止 Task 链和已发布 outbox 的物理 purge，保留必要业务历史。PMS 的显式 `gowm-shared:` preexisting profile 只读已有 secret、跳过 provision，选择 verify-only；PM2 接线已有 secret 文件。其他模式保留原路径。

## 本次实际验证

测试数据库是本次独立创建的 PostgreSQL 18 容器 `smpp-gowm-integration-test-20260908`，不是现有业务库。GOWM 原有安装器安装结构，SMPP 测试只登记 TEST 设备/绑定，通过真实 Repository、Runtime 和 Provider 写业务链。旧模式回归使用另一独立数据库。

| 验证层              | 命令/范围                                                                                                               | 结果                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Source              | lint / typecheck / build                                                                                                | PASS                                             |
| Protocol            | protocol:check                                                                                                          | PASS：11 schemas、74 frozen cases、52 lock files |
| Contract intake     | gowm-storage:check                                                                                                      | PASS                                             |
| Unit                | test:unit                                                                                                               | 252 PASS                                         |
| Adapter contract    | test:contract                                                                                                           | 36 PASS                                          |
| Configuration       | gowm-storage:test:unit                                                                                                  | 11 PASS                                          |
| Shared PostgreSQL   | gowm-storage:test:postgres                                                                                              | 16 PASS                                          |
| Source Runtime E2E  | gowm-storage:smoke                                                                                                      | 1 双设备综合场景 PASS                            |
| Affected regression | Task lifecycle、business-event persistence/retention/fencing、recovery、migration runner、PMS preparation、PM2 renderer | 157 PASS                                         |
| Remote PR           | 未执行远程发布                                                                                                          | NOT_RUN；提供 PR_BODY.md                         |

E2E 使用真实 Runtime MCP HTTP handler（Fastify inject）、真实 gRPC Adapter、源码 UGV Provider 和软件 Device MCP client；状态由受控 MQTT ingress 注入。两组 Runtime 都实际初始化并监听端口。A/B 创建模拟导航，重复 MCP 请求不新增导航；重启 Runtime A 后保持原 Task、派发计数不变；A 的取消仅发到 A 的模拟器，CONTROLLED 回执确认写入，B 保持工作并通过状态回流完成。最终从 `gowm_business_v1` 的 Task、Execution、Dispatch、Mission 视图回读。

首次执行暴露并修复了 JSONB 字段顺序导致的身份误判、事件流 UUID 格式、gRPC 活跃事件流关闭，以及测试在异步事务提交前断言/清理的问题。最终结果文件为 `postgres-results.json` 和 `smoke-results.json`。旧回归的后台调和现等待完成再 TRUNCATE；测试配置排除 dist，避免重复收集编译副本。

## 覆盖限制与交接

`test-results.json` 和 `acceptance-results.json` 保留任务包逐项结果。数据库强制断开、精确窗口硬崩溃、每种子表 FK 错写以及每个后台循环的独立故障注入没有全部执行，已按较窄覆盖标 NOT_RUN；不是复用 GOWM 旧报告的 PASS。没有运行实车、在线 PMS 切换或完整 SDAR Workflow。源码重启验证不是物理 exactly-once 证明。

当前 GOWM 公共视图安装要求 SDAR Schema 和 vector 扩展，隔离库满足此结构前置；没有 SDAR 业务行或进程。SMPP 合同验证在安装 SDAR 结构前已单独通过，后续完整读面测试重新执行通过。

启动、配置及回退步骤见 `docs/GOWM_SHARED_STORAGE.md` 和 `examples/gowm-shared-storage/env.example`。旧数据库不迁移、不删除、不同步。切换前停止原写入方，并处理活跃或结果不确定任务的路由与恢复；不能通过修改 URL 丢弃执行事实。
