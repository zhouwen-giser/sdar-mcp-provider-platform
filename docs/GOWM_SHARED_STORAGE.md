# SMPP 接入 GOWM 共享业务存储

UGV 的 Runtime 与 Adapter 可以共同使用 GOWM database 的固定 `ugv_smpp`，由 GOWM 安装 Schema，SMPP 启动只验证。每个源码实例显式绑定一个设备；部署两组实例即可服务 A/B，两组连接同一数据库。现有非 UGV 的 standalone 入口保留。

## 新开发实例启动

1. 使用包含共享存储功能的 GOWM 版本完成核心迁移及 `business-storage:install -- --domain smpp`。消费者合同来源与完整文件名/哈希保存在 `contracts/gowm-shared-storage/current/source.json`。不要求启动 SDAR。
2. 在 GOWM 登记设备的 world-object 身份及 `device_service_binding`。准备匹配的 device ID、binding UUID、SMPP service key、Provider ID 和 resource ID。
3. 复制 `examples/gowm-shared-storage/env.example`，为 A/B 分别填写上述身份、进程端口、软件设备/MQTT 连接。两份配置的数据库 URL 文件内容必须相同。不要把设备显示名称当作 GOWM device ID。
4. `pnpm build`。加载对应环境后分别运行 `node dist/apps/ugv-provider-adapter/src/main.js` 和 `node dist/apps/runtime/src/main.js`。开发时也可用 `node --import tsx` 运行同名源码入口。启动验证通过后才会开始设备业务处理。
5. 通过原有 MCP Operation 创建新任务，在 GOWM `gowm_business_v1.mcp_tasks`、`provider_executions`、`provider_dispatches`、`mission_links` 按 `device_id` 回读。

`SMPP_STORAGE_MODE=gowm-shared` 必须显式设置。`GOWM_DATABASE_URL` 或 `GOWM_DATABASE_URL_FILE` 是唯一业务连接来源；同时配置的 `DATABASE_URL`、`DATABASE_URL_FILE`、`UGV_ADAPTER_DATABASE_URL` 必须一致。失败不会退回旧库或 public。空设备集合、多个设备、缺失绑定直接拒绝启动。

`SMPP_SOURCE_SESSION_KEY` 标记实际配置的采集连接范围，应在连接来源未变的进程重启间保持稳定。它不是设备 boot epoch。Snapshot 使用 device/source/channel/revision 完整键；事件流 UUID 按设备和连接来源稳定派生，跨设备 source cursor 不互通。进程内 ingress、arbiter、设备客户端、缓存与串行队列仍归属于这一台设备。

## 存储语义

连接池在每条物理连接建立时固定 `search_path=ugv_smpp,public` 及不可变的设备/服务/绑定会话参数。SQL 显式增加设备过滤和写入字段，事务始终使用同一 PoolClient；没有按请求修改的全局 currentDeviceId，也没有运行时 SQL 解析/改写器。

- 根 Admission、Task、Execution 固化 device/binding/service。新 Admission 必须来自当前有效绑定；旧绑定的执行可通过明确保留的旧路由恢复。更换绑定不会修改历史行的归属，新路由不会领取旧路由的任务。
- 幂等保留授权、操作、mode、simulation 和参数哈希语义，并增加设备/服务维度。原生 outbox 的 event_key 仍是全局唯一，因此仅在存储键中加入设备/服务命名空间；协议 Payload 不变。
- Runtime recovery/TTL 租约为 DEVICE 范围，使用最终 `(scope_key,lease_key)` 冲突键，owner 不参与稳定身份。本次 UGV 进程没有新增服务全局作业；不以伪造设备 ID 表示服务范围。
- Provider Task ID 与 MCP UUID 分开保存。Runtime 发布及恢复事务通过 Admission、设备、服务、绑定、operation、argument hash 和真实 external execution ID 核对后，以 NULL→UUID CAS 补 `mcp_task_id` 和已存在 Mission Link，不靠同名 task_id 盲联。
- Dispatch 回执、Mission 身份和关联在同一事务内保存。设备网络调用在事务外。不确定回执保留 UNCERTAIN。相同回执 key 的不同内容报冲突；PENDING/UNCERTAIN 与后续明确回执采用独立状态阶段 key。控制派发使用 CONTROLLED，不新建 Mission。
- 缺少设备原生 session 的回执使用真实 external execution ID 作为 EXECUTION_SCOPED_ID 的范围，不和 MQTT ingest epoch 猜测合并。
- 明确的经纬度目标保存为 EPSG:4326；未知本地 x/y 保留 NATIVE_ONLY。目标绑定与 Task 发布同事务，使用真实 MCP owner key 和参数路径。
- 句柄到期仍生效；共享模式停止 Task 链及已发布 outbox 的物理 purge，保留 Admission、幂等、Dispatch、回执及 Mission 历史。现有临时投影/游标到期规则仍生效。

## PMS / PM2

对明确启用共享存储的 UGV 开发 profile，使用 `databaseMode=preexisting`，`clusterRef=gowm-shared:<环境名>`，并填写既有 GOWM 数据库名。先由部署者提供该 deployment 的既有连接 secret；PMS 只读取并检查连接身份，不创建或改写共享库账号、数据库或权限。数据库准备流程选择 `gowm-shared-verify`，原生 migration engine 不执行。

PM2 effective config 可传 `SMPP_STORAGE_MODE`、`SMPP_SERVICE_KEY`、`SMPP_ALLOWED_DEVICE_IDS`、`SMPP_GOWM_BINDING_ID`、`SMPP_SOURCE_SESSION_KEY` 和 `SMPP_GOWM_CONTRACT_DIR`。共享模式将既有数据库 secret 文件同时映射为 `GOWM_DATABASE_URL_FILE`。PMS 自身数据库和其他 profile 不变。本任务未启动或切换用户现有 PMS 部署。

## 验证

```sh
pnpm gowm-storage:check
pnpm gowm-storage:test:unit
pnpm gowm-storage:smoke -- --help
# 以下必须是单独的测试库，先由 GOWM 正式安装器初始化
SMPP_GOWM_TEST_ENABLE=true SMPP_GOWM_TEST_DATABASE_URL=... pnpm gowm-storage:test:postgres
SMPP_GOWM_TEST_ENABLE=true SMPP_GOWM_TEST_DATABASE_URL=... pnpm gowm-storage:smoke
```

缺少显式测试环境时，PG/smoke 返回 NOT_RUN 和退出码 2。测试不会自动安装/清空 Schema。Fixture 只登记 TEST 设备与绑定，Task/Execution/Dispatch/Mission 由实际 Repository 或 Runtime/Provider 产生。

当前 GOWM 的公共视图安装依赖 SDAR Schema 和 vector 扩展；这仅是公共读取面测试的结构前置。SMPP 单独启动已验证无需 SDAR Schema。测试不写 SDAR 业务行，不声称上游 SDAR Workflow 已接入。

## 切换与回退

本次只提供新实例的接入能力，没有迁移旧数据、删除旧数据库或切换运行服务。正式切换前先停止原写入方，确认待接管设备的活跃/不确定任务及其原路由。不要让旧库和 GOWM 两个写入方同时控制同一设备。

回退前必须停止新派发并处理 GOWM 中活跃及结果不确定的执行；不能仅修改 URL 后丢弃恢复事实。旧数据库保留，不增加导出、同步或双写链。
