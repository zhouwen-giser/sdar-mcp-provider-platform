# v1.3 V-INPUT：匿名业务答复与恢复

验证层级：本地合同、故障注入，以及真实 HTTP → Runtime PostgreSQL → gRPC → Provider PostgreSQL 链路。设备和规划服务为受控夹具。

验证结果：PASS。

`AUTH_MODE=development` 为请求生成固定的内部 development 来源。客户端不需要凭据或角色；来源记录为 `development_anonymous`，Provider 审计 `verified=false`。匿名查询、任务创建/查询/取消、暂停/恢复、Input accept/decline/cancel 和导航 Intervention 均有公开 HTTP 链路断言。

仍然保留以下限制：

- Task/Execution、请求标识、请求版本、subject、deadline、Intervention 版本和计划版本必须有效。
- 相同 `commandId` 只允许等值重试；改内容冲突。客户端伪造 `respondedBy` 被公开参数解析拒绝，换授权 subject 无法回答原 Task。
- Intervention HTTP receipt 表示持久受理。版本守卫由 Provider 异步执行；用例核对最终 `INTERVENTION_REVISION_CONFLICT` / `PLAN_REVISION_CONFLICT`，并证明没有采用新计划。
- Input 的 decline/cancel 释放请求受理后仍等待扫描恢复；取消提示不是取消 Task。
- `anonymous`、JWT、trusted-headers 认证模式沿用原要求，不能冒充 development 来源。

命令受理时在既有 JSON ledger 保存原始 responder 来源；提交后不可改写。重启恢复不再拼造一个 user 身份。故障注入覆盖受信用户、匿名 development 的解锁后提交失败，恢复不会重复解锁。旧 ledger 没有 responder 字段时保持可读，等待 Runtime 重放原答复信封；不补造身份，超过原期限仍执行既有无法恢复处理。

“暂停 → 设备确认 → 恢复 → 设备确认 → 调整路线”同时覆盖了历史控制记录保留的情形：仅尚待确认的控制阻塞调整，已完成的控制记录继续用于审计。

证据：[本地 UGV 回归](evidence/local-ugv.log)、[live HTTP 与 Provider](evidence/native-live-and-provider.log)、[共享 GOWM 回归](evidence/gowm-shared.log)。无新增表、身份系统、SDK 或公共命令字段；未部署到现场。
