# Runtime / Provider / PMS Migration Set Design

## 目标目录

```text
migrations/runtime/          # 原 001～023，文件内容不变
migrations/providers/ugv/    # 原 024_ugv_provider.sql
migrations/providers/npc-tank/ # 原 025_npc_tank_provider.sql
migrations/pms/              # 新增 PMS Migration
```

建立 `migration-source-map.json`，记录旧路径、新路径、SHA-256、owner、sequence。Runner 必须显式接收 migration set，禁止扫描整个根目录。

Runtime/Provider 迁移入口继续兼容原 CLI，但内部使用明确 set。迁移隔离测试使用三个空库或三个隔离 Schema，证明 Runtime 不创建 Provider 表，Provider 不创建 Task Authority 表。
