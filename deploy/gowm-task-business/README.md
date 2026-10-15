# SMPP 共享业务表部署 SQL

此目录属于 SMPP，不修改 GOWM 或 isr-simulation 源码仓库。SQL 安装在已有 GOWM 数据库的固定 `ugv_smpp` schema，复用 `ugv_smpp_app`；不创建数据库、账号、密码或设备专属 schema。

联合包 `deploy.sh up` 在 PostgreSQL 备份及原 GOWM SMPP 域安装后，通过 `prepare-gowm.mjs --apply` 显式运行本迁移。单独部署 SMPP 时，在服务器包目录使用相同的 `deploy/development/server/prepare-gowm.mjs --apply`，先按原部署流程备份数据库。无 `--apply` 为只读预检。不要绕过部署器直接执行裸 SQL，否则不会提交对应迁移记录。

迁移包含 `SMPP_RUNTIME/027_task_business_intervention_command.sql`（前置 Runtime 026）和 `UGV_PROVIDER/030_task_business_versions.sql`（前置 Provider 029）。Runtime 027 扩展已有命令通道以接收 `INTERVENTION`，校验请求载荷，并按 `device_id + task_id + commandId` 去重；不创建第二条任务通道。部署器使用与 GOWM 安装器相同的 advisory lock 718079，把 Runtime 命令约束、四张业务表、索引、RLS、触发器、授权和 `ugv_smpp.gowm_install_history` 记录放入一个事务。任何错误回滚整个业务表迁移；原有数据不会被删改。重试不会重建表或重复记录；已安装校验和不同会拒绝继续。重复部署会恢复版本表及内容表的只读/追加权限。

SQL 的固定 SHA-256 分别位于 `contracts/gowm-shared-storage/current/task-business-runtime.json` 和 `task-business.json`，包生成时检查两者一致。该文件在构建镜像前已经存在，不依赖现场修改镜像内容。应用启动继续使用严格的只读校验器。基础 GOWM 合同保持原始快照；只有存在已固定 SHA 的 Runtime 027 安装记录时，才接受该命令类型约束的精确新定义。启用导航调整时，缺失此迁移会在 Provider 启动阶段被拒绝。

这是一项追加的 SMPP 部署迁移。当前 GOWM 自身的完整结构审计使用固定清单和对象数量，尚未包含此追加项，运行该旧审计会报告清单差异；不能把它记为完整 GOWM 资格通过。后续 GOWM 清单吸收此版本时，应保留已安装 SQL 的相同校验和，不能用不同字节覆盖迁移历史。

本地隔离验证命令：设置 `SMPP_GOWM_BUSINESS_DEPLOY_TEST_URL` 为专用空测试数据库后运行 `pnpm test:task-business:gowm-deployment`。此测试不等于 sz-gowm 安装、完整选定存储测试或 Runtime 进程重启验收。
