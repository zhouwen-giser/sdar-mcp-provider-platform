# Runtime Deployment State Machine

`REQUESTED → DATABASE_PROVISIONING → MIGRATING → CONFIG_PREPARING → STARTING → HEALTH_CHECKING → DISCOVERING → ACTIVE`。

辅助状态：`STOPPED、DRAINING、DEGRADED、FAILED`。每次转移需要 expected previous state/revision，重复 Worker 执行必须幂等。PM2 online 不能直接进入 ACTIVE。
