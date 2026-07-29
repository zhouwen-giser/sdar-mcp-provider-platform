# Security and Authority Rules

- PMS 只拥有控制面状态，不读取或写入 Runtime Task Authority 业务表。
- Runtime 可以在 PMS 和 Worker 离线时继续处理既有任务。
- Worker 停止只停止调度与控制连接，不停止已运行 Runtime。
- PM2 仅允许 `sdar-runtime-*` 命名空间、固定 Release Root 和固定 Runtime Entry。
- PM2 Bridge 不得提供 Shell、Exec、命令字符串、任意脚本或任意 cwd。
- Secret 只能通过 SecretRef、受控文件和权限最小化路径传递。
- Database URL、Token、Secret 内容不得进入日志、Audit、PM2 普通环境、测试 Evidence、SBOM 或 PR 文本。
- 允许进入 PM2 环境的漂移指纹必须是非 Secret：Runtime Version、Config Revision、Bootstrap Checksum。
- `PM2 online`、HTTP live 或单次 register 都不能单独推出 RuntimeDeployment ACTIVE；必须完成 Health、Identity、Catalog 和 Registry 收口。
- 外部 SDAR 与真实设备仍保持未认证状态。
