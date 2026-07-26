# Data Model and API Design Notes

核心实体：ProviderType、ProviderPackage、Provider、Resource、ProviderResourceBinding、ConfigDefinition、ConfigRevision、ConfigAck、RuntimeDeployment、RuntimeProcess、DatabaseProfile、CatalogSnapshot、RegistrySnapshot、AuditLog、JobLease。

管理 API 使用 `/api/v1`；长时部署动作写期望状态并返回 Job/Operation ID。Runtime Client API 独立认证：latest/watch/acks/heartbeat。基础设施 PM2/Provisioning Port 不公开为任意命令 HTTP API。
