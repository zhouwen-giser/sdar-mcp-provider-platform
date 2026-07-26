# Infrastructure Ports Contract

`RuntimeInfrastructureAdapter` 提供 provisionDatabase、migrateDatabase、renderBootstrapConfig、start、stop、restart、delete、inspect、reconcile。数据库与 PM2 实现不进入 domain；所有返回值使用稳定状态和错误 code，支持幂等键、超时、重试策略和审计上下文。
