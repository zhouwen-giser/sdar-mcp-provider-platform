# v1.3 提交与 sz-gowm 部署 — 2026-10-03

实现提交：`0a4a7c36865d4c9920a4e65857c0903e9ef12533`。已推送 GitHub，并将现有 [PR #35](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/35) 更新为正式待审状态；可合并，尚未合入 main。

该提交的 [CI 37132978147](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/37132978147) 中 static、development-tests、task-business-ugv 全部通过。其余 release/dispatch 专用作业按工作流条件跳过，未视作通过。

后续交付文档提交 `ff495bc` 的 [CI 37133939847](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/actions/runs/37133939847) 出现一项测试失败：Recon 测试的全局递增样本时间可能领先 Runtime 时钟，启动前被判为 `UGV_STATE_STALE`。现将该测试改用同一受控时钟，显式推进派发前、派发后、运行中和终态样本时间；原断言与生产新鲜度限制不变。修复后本地 Provider 集成 94 项、完整 UGV 本地集 407 项及 typecheck、单文件 lint/format 均通过。最新托管检查以 [PR #35 Checks](https://github.com/zhouwen-giser/sdar-mcp-provider-platform/pull/35/checks) 为准；本次跟进只有测试与交付记录变更，已部署应用源码仍对应 `0a4a7c3`。

## 运行身份

- 更新时间：2026-10-03 23:33（Asia/Shanghai）。
- MCP：`http://sz-gowm:19100/mcp`；在服务器本机使用 `http://127.0.0.1:19100/mcp`。
- Runtime：`smpp-gowm/runtime:0a4a7c36865d4c9920a4e65857c0903e9ef12533`。
- Adapter：`smpp-gowm/adapter:0a4a7c36865d4c9920a4e65857c0903e9ef12533`。
- 当前源码/配置目录：`/mnt/data/smpp-v13-20261003-0a4a7c36865d/source/deploy/development/server`。
- 上传源码归档：`/mnt/data/smpp-ugvbiz-v13-0a4a7c36865d-source.tar.gz`；SHA-256 `e1e39b0246e6d6a3cfcee82a3e309e1b27f3d8a9a999fa50149ec5052aae5004`。
- 构建输入从该提交导出，排除 Docker 构建不使用的 reports、.github、.codex；未混入其他历史工作区改动。它是本次镜像更新的源码归档，不是重新生成的全栈联合包。

运行配置已切换为 `UGV_EXECUTION_MODE=live`、`AUTH_MODE=development`；保持 `UGV_FIRE_ENABLED=false`、未来时间容差 3000 ms、原过期阈值、估算 Map-full 与 navigation adjustment Profile。Provider `isr.vehicle.ugv.ugv`、resource `vehicle:ugv`、GOWM device `ugv:ugv`。

GOWM 连接文件按原字节复制到新配置目录；共享绑定、MQTT source session、外部网络和两个 SMPP named volume 保持不变。其他 78 个容器身份未改变。切换前查询活动 UGV Execution 数量为 0；没有新建数据库、角色或业务表，也没有执行车辆控制。

保留旧版本镜像与配置用于回滚。旧目录为 `/mnt/data/smpp-business-feedback-20260930/smpp-gowm-gdps-gsap-cbabdfc23eefc58e/smpp/deploy/development/server`；未经后续确认不清理其配置和镜像。后续维护应使用上面的新目录，避免从旧目录重新启动旧版。

## 部署后验证

镜像在禁网容器中完成依赖、revision、development 匿名来源、live 默认、业务投影和 Adapter Profile 检查；实际配置加载通过后才切换 Runtime/Adapter。

`/health/live` 与 `/health/ready` 返回 200。无 Authorization、execution-mode、simulation-id 头的 discover、tools/list、vehicle_get_state、vehicle_get_payload_status、vehicle_get_targets 均成功；三个查询的 manifest 包含 businessSemantics schema，返回 `ugv.business-semantics/1`。

本次读取到 Recon idle、unlocked、cameraFault=false、loadStatus=1。`payloadHealth=unknown` 是未确认载荷码的预期投影，不将 1 猜测为 normal，也不把 unknown 当作已报告 fault。目标观测时间为 null；这些只读结果不证明发现目标或完整业务链已经验收。

Runtime/Adapter 本次启动以来的日志检查未发现 check-constraint 或 finalizer 失败。没有重复导航、侦察、锁定、Input 或发射现场功能测试。外部 SDAR 联调结果由接收方另行记录。

证据：[部署回执](deployment-20261003/deployment.json)、[镜像检查](deployment-20261003/image-verification.json)、[现场只读验证](deployment-20261003/passive-verification.json)、[CI](deployment-20261003/hosted-ci.json)、[PR 状态](deployment-20261003/pr-status.json)、[源码归档](deployment-20261003/source-archive.json)。

## 联调交接

接入时使用 live（可省略模式头），不发送 simulation-id 或凭据。保持冻结协议版本 2026-07-28、TaskBusiness 1.0-rc2、BusinessEvents 1.0。客户端不能自填 responder 权限，业务 request/revision/subject/plan/commandId 守卫继续生效。

接口说明见 [UGV MCP 指南](../../docs/ugv-provider-mcp-api-guide.md)。已向 SDAR 仓库任务「完成 SMPP 共享存储部署」（01a083eb-55ff-7690-955c-878198cb1dab）发送联调通知，包含实际端点、模式、版本、限制与文档；见[交接回执](deployment-20261003/sdar-handoff.json)。该记录只证明通知已发送，SDAR 联调结果仍由接收任务记录。
