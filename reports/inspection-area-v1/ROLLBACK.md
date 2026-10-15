# 区域检查与巡逻发布回退

适用范围：本次本地发布。首先通过官方 upgrade-preflight 和 Core/Adapter 查询确认任务、远端等待、待派发、队列租约与管理操作均为空闲。现场活动任务不纳入本次回退授权。本次实际生产回退演练为 NOT_RUN。

1. 比对 GOVERNANCE_BEFORE.json 与 GOVERNANCE_AFTER.json，通过原生治理 API 暂停本次新增的 Exposure、Capability 发布版本：POST /api/v1/a2a-exposures/{id}/versions/{version}/suspend 及 POST /api/v1/node-capabilities/{id}/versions/{version}/suspend。使用当前 ETag、Idempotency-Key、管理身份和 reason，等待管理操作成功并刷新 Agent Card。保留任务报告及全部治理历史。
2. 从私有持久备份目录 `/home/sz/.smpp-debug/inspection-area-v1-20261014/backups` 核对 DEPLOYMENT_BEFORE.json 中的原始 SHA256 和 0600 权限。先仅恢复 smpp-compose.before.json 到原位置，使检查开关关闭，并仅对 `gowm-analysis-dev-f3dc6f4b8e-smpp` 的 adapter/runtime 执行 docker compose up -d --no-deps --no-build。只读确认 19100 恢复精确 12 工具。
3. 暂时保留已更新、支持同一 Provider 目录变更 CAS 的 SDAR 镜像。通过原生 Source bootstrap 刷新当前 Registry Candidate；读取当前 Binding revision 及精确 Candidate 的 Source/Provider/server/Registry revision/checksum/endpoint。对 POST /api/v1/mcp-provider-bindings/{id}/refresh 提交现有 rebind 合同：expectedRevision、reason、payload（上述精确 Candidate 字段）及稳定 Idempotency-Key。等待管理操作成功，确认 operationCount=12、当前 Registry 谱系、原 Binding/Provider/资源身份及旧版本可读。后台若已先刷新目录，新镜像用紧邻不可变前驱证明真实目录变化；不得直接改数据库、回退 revision 指针或绕过 CAS。
4. 目录与谱系完成对齐后，再将 sdar-compose.before.json、sdar-environment.before.json 恢复到原位置，并仅对 `sdar-sz-gowm` 的 control-api/control-worker/runtime 执行 docker compose up -d --no-deps --no-build。SDAR 配置恢复 ugv-v1-12。旧镜像不支持同一 Provider 的该 CAS 变更，因此不能在第 3 步前恢复。
5. 运行旧目录配置的官方 bootstrap，核验旧能力的当前有效绑定。只读确认检查能力不再对外发布、旧目录工具数为 12、PMS 正常，以及原挂载、卷、绑定身份、配置和签名密钥指纹均与基线一致。治理与 Binding 版本继续递增；保留旧版本、任务、检查发现与报告。旧版本原有的巡逻检查依赖缺口按历史状态保留。

原项目名、数据库卷、网络、端口和密钥不重建；不删除卷或重新初始化绑定。apply-update.py 在初次治理发布前提供镜像启动失败的自动恢复；upgrade-sdar.py 在本次 SDAR 后继镜像健康检查失败时仅恢复其升级前的三个 SDAR 服务。这些自动恢复路径不能替代发布后的原生撤回及目录 CAS 顺序。最终私有备份位置和校验值以 DURABLE_DELIVERY.json、DEPLOYMENT_BEFORE.json 及 SDAR_CAS_UPDATE.json 为准。
