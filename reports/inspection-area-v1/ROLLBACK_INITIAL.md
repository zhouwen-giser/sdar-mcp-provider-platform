# 区域检查与巡逻发布回退

适用范围：本次本地发布。先检查 SMPP Core、Adapter、SDAR Task、远端等待、队列租约和治理操作均为空闲。现场活动任务不纳入本次回退授权。

1. 比对 `GOVERNANCE_BEFORE.json` 与 `GOVERNANCE_AFTER.json`，以原生治理 API 暂停本次新增的已发布 Exposure 和 Capability 版本。接口为 `POST /api/v1/a2a-exposures/{id}/versions/{version}/suspend` 及 `POST /api/v1/node-capabilities/{id}/versions/{version}/suspend`。沿用当前 ETag、Idempotency-Key、管理身份与 reason，等待对应管理操作成功；重建公开 Agent Card。
2. 私有备份目录：`/tmp/smpp-inspection-v1-20261014/deployment`，文件为 `smpp-compose.before.json`、`sdar-compose.before.json`、`sdar-environment.before.json`，权限 0600。核对 `DEPLOYMENT_BEFORE.json` 中 SHA256 后，恢复对应原位置。原 SMPP 配置和镜像的检查开关默认为关闭；SDAR 目录恢复 `ugv-v1-12`。
3. 原项目名保持 `gowm-analysis-dev-f3dc6f4b8e-smpp` 和 `sdar-sz-gowm`。只对前者的 `adapter runtime`、后者的 `control-api control-worker runtime` 执行 `docker compose -f 原配置路径 up -d --no-deps --no-build`。原镜像引用和配置内容在备份中；不删除卷、不重新初始化绑定或密钥。
4. 在恢复后的官方 bootstrap 中，以旧目录配置刷新 Registry/Provider 物化及既有能力的当前有效绑定。治理 revision 与版本继续递增，保留完整历史。旧版本原有的检查依赖缺口按历史状态保留。
5. 只读检查 19100 工具目录恢复 12 项、检查工具不再发布，PMS 正常，原挂载、绑定、配置、签名密钥指纹与基线一致。保留已经生成的检查报告、任务和治理版本记录。

`apply-update.py` 对镜像启动失败提供配置及五个服务的自动恢复。该路径发生在新增治理发布之前；发布后的回退另按上述原生暂停步骤执行。本次未主动执行生产回退，配置差异与回退素材已校验。
