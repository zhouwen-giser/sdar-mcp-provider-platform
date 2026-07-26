# Codex Execution Contract

## 1. 原子任务规则

- 状态：`PLANNED | READY | IN_PROGRESS | PASSED | BLOCKED | FAILED | SKIPPED`。
- 只有依赖全部 `PASSED` 的任务可进入 `READY`。
- 同一时间最多一个 `IN_PROGRESS` 任务。
- `SKIPPED` 仅允许任务卡明确给出条件，并记录理由与批准来源。
- 任务失败先修复本任务，不通过跨阶段补偿隐藏失败。

## 2. Git 规则

- 初始源码导入提交：`chore: import offline runtime provider baseline`。
- Goal 1 分支：`codex/goal-01-platform-foundation`。
- Goal 2 分支：`codex/goal-02-runtime-governance`。
- 推荐提交格式：`<type>(<scope>): <task-id> <summary>`。
- 不使用 `git reset --hard`、`git clean -fdx`、改写历史或强推，除非用户明确要求。
- 不提交数据库密码、Token、私钥、真实设备地址或本地生成的大型运行数据。

## 3. 代码质量

- TypeScript strict 保持开启；不得引入 `any` 作为领域模型逃生口。
- 领域包不依赖 Fastify/React/PM2/PostgreSQL 具体实现。
- Port/Adapter 边界使用可替换接口；PM2、Postgres、HTTP、文件 Secret 均在基础设施层。
- 错误使用稳定 code + message + details，禁止依赖字符串匹配做状态机。
- 写操作具备幂等键或状态前置条件；网络调用不持有数据库长事务。

## 4. 测试与门禁

- 不删除原 Runtime、UGV、NPC、HA、冻结协议和安全测试。
- 无法运行 PostgreSQL/PM2 E2E 时，仍需运行静态、单元与 fake-adapter 测试，并记录缺失条件。
- 测试应证明边界：Migration 不串库、Provider 隔离、PMS 不触碰 Runtime Task 表、Secret 不泄漏、PM2 不允许任意脚本。
- 卡片未指定命令时，至少运行受影响 package 的 lint、typecheck、unit test。

## 5. 变更控制

以下变化必须写 ADR：

- 修改总体模块边界；
- 变更数据库隔离模式；
- 引入新的运行编排技术；
- 改变配置 Apply Mode；
- 改变 Registry/Catalog 权威来源；
- 修改冻结协议或 Adapter Protocol；
- 允许同 Provider 多副本稳定入口的新实现。

## 6. 阻断规则

只有同时满足以下条件才标记 `BLOCKED`：

1. 当前卡片验收必须依赖该资源；
2. 本地 fake/in-memory/static 不能提供等价证据；
3. 已记录命令、错误、环境、已尝试方案；
4. 给出解除阻断所需的最小外部动作。

不得因为 Docker 不可用而阻断不需要容器的任务；不得因为宿主缺少 `psql` 而忽略可用的 Node PostgreSQL 客户端或已有数据库 URL。
