# Baseline

- 输入 ZIP：`pms-web-complete-prototype.zip`
- 解压位置：独立工作目录，原 ZIP 未修改。
- 原工程位置：压缩包根目录 `pms-web/`；按任务要求规范为 Workspace 内唯一应用 `apps/pms-web/`，未创建平行控制台。
- Node：v22.16.0
- 目标 pnpm：10.14.0；执行环境无法从 registry 下载 pnpm。
- React：19.2.8
- TypeScript：原声明缺失，生产化后声明 5.9.3；环境全局 tsc 为 5.8.3。
- Vite：8.1.5
- 原测试文件：11（9 个 test + 2 个 E2E）
- 原正式及原型路由：123
- Feature 一级目录：18
- 原输入包包含旧 `dist/`，为避免交付陈旧构建产物已删除。
- 原始构建结果：输入包的上一轮说明称未能完整安装依赖；本轮重新执行同样被 registry DNS 阻断。

## 原始架构事实

- `App.tsx` 使用大量 `if/else` 分发页面。
- `src/router.ts` 使用 `pushState`、`popstate` 与自研匹配。
- 页面通过 `useDataQuery` 与集中式 `PmsWebDataSource` 获取数据。
- Prototype Banner、场景入口部分暴露在 Shell 中。
