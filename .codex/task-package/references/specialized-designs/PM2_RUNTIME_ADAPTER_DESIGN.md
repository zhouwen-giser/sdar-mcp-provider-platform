# PM2 Runtime Adapter Detailed Design

内部组合：PostgresProvisioner、RuntimeMigrationRunner、BootstrapConfigRenderer、Pm2ProcessManager、RuntimeHealthProbe。它是 PMS Worker 的基础设施 Adapter，不是独立开放式 Agent。

启动链：校验 Provider → 准备 Runtime DB → Migration → 解析配置和 SecretRef → 写 0600 文件 → PM2 Fork start → live/ready → 身份校验 → Discover → ACTIVE。

所有命令受 allowlist；实例名 `sdar-runtime-{environment}-{providerSlug}-{ordinal}`；每进程独立 instanceId、port、PID、日志和 LKG 目录。
