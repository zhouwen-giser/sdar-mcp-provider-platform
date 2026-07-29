# Goal 04 Acceptance Checklist

- [ ] Goal 03 全部任务为 PASSED，且历史状态未被修改
- [ ] `pm2@7.0.3` 为仓库固定依赖
- [ ] 生产 JavaScript API Bridge 存在且无 Shell/CLI 接口
- [ ] 真实 PM2 E2E 不含 `pnpm dlx pm2`
- [ ] Bootstrap/Config/Version 漂移触发受控 restart
- [ ] Worker 配置拒绝内联 Secret、符号链接和宽权限文件
- [ ] 周期 Scheduler 使用数据库时间、互斥和有效 Job 去重
- [ ] Worker Production Composition 只注册两个外部 Job Type
- [ ] Worker Shutdown 不停止已运行 Runtime
- [ ] Worker→PM2→Runtime→Registration→Catalog→Registry→ACTIVE E2E 通过
- [ ] Runtime crash、Adapter 故障、Worker/PMS 重启场景通过
- [ ] Platform CI 的最终 Jobs 绿色
- [ ] Provider 回归和 Runtime 历史门禁未削弱
- [ ] 根 Platform 版本与 Runtime 组件版本分离
- [ ] Release Manifest 无 `commit-containing-this-*` 占位符
- [ ] SBOM、Checksums、Evidence 和 Handoff 已更新
- [ ] Goal 04 PR 目标为 Goal 03，未合并 main，未创建 Tag
