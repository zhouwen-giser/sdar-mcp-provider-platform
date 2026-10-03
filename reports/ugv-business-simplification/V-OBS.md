# v1.3 V-OBS：侦察关联、锁定与业务投影

验证层级：本地受控设备夹具；包含真实 Runtime HTTP、Adapter gRPC 和 PostgreSQL。`live` 是请求执行模式，不代表这次连接了现场设备。遵照用户要求，未重跑已完成的现场功能测试。

验证结果：PASS。

- `ugv-recon-execution-correlation.test.ts` 验证显式 mission 匹配为 `STRICT_CORRELATED`；缺少 identity 且只有一个当前活动 Recon 时为 `INFERRED_CURRENT_EXECUTION`。显式不匹配、冲突 identity、无活动执行、多活动执行、过期、retained、执行前以及创建/dispatch 边界同时间的数据均不能归属。
- `ugv-provider-auto-lock.test.ts` 验证 live/simulation × strict/inferred × 受信用户/development 匿名 × 三种观察决策。锁定使用当前 Execution 最新 mission ID；ACK 和 stage 2 不产生有效 Input，命令之后同一目标的 stage 3 才进入 active。重复观测、目标丢失、超时和扫描恢复沿用原有处理。
- `ugv-development-business-postgres.test.ts` 通过不带 Authorization、actor、execution-mode、simulation-id 头的真实 HTTP 请求创建 live Recon。受控观测触发锁定、RequiredInput，并通过公开接口答复及取消；检查设备终止命令为 `ugv_area_recon_control cmd_type=4`。
- 同步状态、载荷和目标查询返回统一的 `businessSemantics`。Context 和 Recon 事件使用同一函数，保留 inferred 来源，不将其升级为 strict；未知数值仍可见，语义为 `unknown`，不会驱动成功终态或伪造 Action。

证据：[本地 UGV 回归：407 项](evidence/local-ugv.log)、[live HTTP 与 Provider：99 项](evidence/native-live-and-provider.log)。详细断言见对应的 `tests/contract`、`tests/integration` 文件。

发射保持禁用。本记录不证明新的真实目标发现、真实车辆运动、设备固件资格或外部消费方验收。
