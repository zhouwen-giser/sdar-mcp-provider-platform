# Test and CI Rules

1. `verify:v2` 的语义和子门禁不得减少。
2. Docker 修复必须在干净 Build Context 中验证，不能依赖宿主已有 `node_modules`。
3. 新 CI Job 必须使用 Node 22、pnpm 11.13.1 和 PostgreSQL 17。
4. 不得使用 `continue-on-error`、`|| true`、空测试或始终成功脚本。
5. 新增测试脚本必须在测试目录为空时失败关闭。
6. 所有数据库测试使用临时 Schema/Database，并清理资源。
7. CI 日志和 Evidence 不得包含 Secret。
8. `runtime-compose`、`runtime-ci` 和 `pms-api-production` 均须通过。
9. Goal 03 不要求 Worker/PM2 Production E2E 通过，因为该能力明确延期；不得伪造该门禁。
