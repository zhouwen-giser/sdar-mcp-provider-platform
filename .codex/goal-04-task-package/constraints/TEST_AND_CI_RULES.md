# Test and CI Rules

1. 不得删除、跳过、改名规避或弱化现有 `verify:v2`、`verify:platform`、Provider 回归和协议门禁。
2. 新生产路径必须有真实 PostgreSQL、真实 PM2、built Runtime 和正式 Composition 的测试。
3. PM2 E2E 不得使用 `pnpm dlx`、临时下载或直接 CLI 启动 Runtime。
4. Worker E2E 不得使用内存 Repository、Fake PM2、恒真 Prerequisite 或手工推进 Deployment 状态。
5. 故障注入必须验证状态与恢复，不得只断言进程退出。
6. CI 所有安装必须 `pnpm install --frozen-lockfile`。
7. CI 使用 Node 22、pnpm 11.13.1、PostgreSQL 17、仓库固定 PM2。
8. 每个 Job 上传精简 Evidence，不上传 Secret、PM2 dump、数据库连接串或 Credential 文件。
9. 外部资源缺失只能保留资格边界，不能把本地 Mock 结果升级为真实认证。
