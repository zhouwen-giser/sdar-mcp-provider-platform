# Database and Migration Rules

- PMS Control DB、Runtime Task Authority DB、Provider Adapter DB 是不同逻辑权威。
- 一个逻辑 Provider 的 Runtime 副本共享一个 Runtime DB；不同 Provider V0.1 推荐独立 Database。
- Runtime Migration 只扫描 `migrations/runtime`；UGV/NPC 各自扫描自己的 Provider Migration Set；PMS 只扫描 `migrations/pms`。
- 原 001～025 SQL 内容不可修改；移动后保留 source path、SHA-256 与映射清单。
- 新 Migration 追加式，不修改已应用文件；使用 advisory lock、version table、checksum。
- PMS 代码不得导入 Runtime Task Repository；测试必须证明此边界。
- Provisioning Credential 与 Runtime Credential 分离，前者不得注入 Runtime。
- Migration 失败保留数据库并阻断启动，禁止自动清库重建。
