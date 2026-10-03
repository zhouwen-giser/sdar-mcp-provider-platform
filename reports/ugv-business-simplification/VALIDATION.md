# v1.3 验证记录

核对日期：2026-10-03。源码基线为 `367910c75f4ffa3969aed1f612b77d74a6518ed4`，结论适用于其上的当前工作区改动；尚未提交、发布或部署。此前 v1.2 的现场证据保持原状。

## 验证环境与证据边界

- 单元、合同、Provider 回归使用受控设备观测和故障注入。
- 匿名 live 业务链使用真实 Runtime HTTP、Adapter gRPC、PostgreSQL 持久化，以及受控 Device MCP / Airport Planner 夹具。没有访问现场设备。`live` 表示请求执行模式，不能单独证明现场验收。
- Native PostgreSQL 用例创建并清理各自的测试 schema。GOWM shared 用例使用本地选定安装夹具，验证固定共享存储接入；owner-template / deployment 用例在临时空数据库中验证 SQL、事务和重试。
- 最终集成回归的容器仅绑定随机本机端口，使用本地已有镜像；清理只针对本次创建的容器及其临时数据卷。未操作 sz-gowm 的容器、镜像、数据库或数据卷。
- 日志不包含数据库连接凭据。各门槛有重叠用例，不将下面的数量相加为唯一测试总数。

## 测试门槛

数据库 URL 和选定安装配置通过对应环境变量注入，未写入本记录。

| 门槛 / 命令                                                                                                                                   | 结果与证据                                                          | 覆盖范围                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `pnpm test:task-business:ugv-local`                                                                                                           | PASS：23 文件、407 项；[日志](evidence/local-ugv.log)               | 全部 UGV TaskBusiness 本地套件：导航、调整、关联、AutoLock、Input、地图、事件、投影 |
| live HTTP + Provider：`vitest run tests/integration/ugv-development-business-postgres.test.ts tests/integration/ugv-provider-adapter.test.ts` | PASS：2 文件、99 项；[日志](evidence/native-live-and-provider.log)  | 暂停/恢复后的路线调整修复，以及匿名公开接口业务链                                   |
| `pnpm test:task-business:ugv-native`                                                                                                          | PASS：3 文件、32 项；[日志](evidence/native-postgres.log)           | Native PostgreSQL、公开 TaskBusiness、匿名 live HTTP 链和持久审计                   |
| `vitest run tests/unit tests/contract tests/security tests/e2e/ugv-provider-grpc-e2e.test.ts`                                                 | PASS：102 文件、716 项；[日志](evidence/unit-contract-security.log) | 单元、manifest / 合同、安全与 UGV gRPC                                              |
| `pnpm --filter @sdar/runtime-configuration-contract test`                                                                                     | PASS：8 文件、46 项；[日志](evidence/configuration.log)             | 配置 schema、兼容性、部署配置清单                                                   |
| `pnpm test:task-business:ugv-gowm`                                                                                                            | PASS：1 文件、12 项；[日志](evidence/gowm-shared.log)               | 选定本地共享 GOWM 安装的绑定、持久化、写入及恢复                                    |
| `pnpm test:task-business:gowm-template`                                                                                                       | PASS：2 文件、9 项；[日志](evidence/gowm-template.log)              | 业务表 owner-template 和准入检查                                                    |
| `pnpm test:task-business:gowm-deployment`                                                                                                     | PASS：1 文件、7 项；[日志](evidence/gowm-deployment.log)            | 打包 SQL 的事务、失败回滚和重试                                                     |

最终 Runtime / Provider 扩展回归 PASS：`pnpm exec vitest run tests/integration tests/recovery tests/e2e tests/protocol-conformance tests/runtime-conformance-closure tests/runtime-conformance-followup`，76 文件、634 项通过，3 文件、25 项因专用 GOWM 环境变量未设置而跳过；这 25 项由上表 GOWM shared（12）、owner-template（6）和 deployment（7）分别通过，template 命令另含 3 项合同检查。见[最终运行日志](evidence/runtime-provider-final.log)与[容器清理记录](evidence/runtime-provider-cleanup.log)。本次整体退出码为 0，涵盖已修复的 lease race、Runtime SSE、协议请求、输入 inbox / 恢复、并发锁顺序及 Provider 兼容回归。

## 静态与合同门槛

| 检查                       | 证据                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`           | PASS；[日志](evidence/typecheck.log)，2026-10-03 在最终测试夹具补全后再次通过                                                 |
| `pnpm build`               | PASS；[日志](evidence/build.log)                                                                                              |
| `pnpm lint`                | PASS；[全仓日志](evidence/lint.log)，随后改动的[增量检查](evidence/lint-delta.log)、[lease 夹具检查](evidence/lease-lint.log) |
| `pnpm format:check`        | PASS；[日志](evidence/format.log)；包含新增收口文档的最终全仓检查见 [最终格式日志](evidence/format-final.log)                 |
| `pnpm task-business:check` | PASS；[日志](evidence/task-business-contract.log)：现有合同、夹具和 Adapter proto 兼容性                                      |
| configuration schema check | PASS；[日志](evidence/configuration-schema.log)                                                                               |
| `pnpm protocol:check`      | PASS；[日志](evidence/frozen-protocol.log)：11 个 schema、74 个冻结用例定义、63 个锁定文件；这是静态验证，运行验证单列        |
| `pnpm sbom:check`          | PASS；[日志](evidence/sbom.log)：358 个生产组件                                                                               |
| `git diff --check`         | PASS；收口时再次核对                                                                                                          |
| `scripts/goalcheck.py`     | `PACKAGE_OK tasks=12 phases=6`；仅证明任务包清单与依赖，不替代实现验收                                                        |

## 业务链断言

`tests/integration/ugv-development-business-postgres.test.ts` 在请求中省略 Authorization、actor、execution-mode 和 simulation-id 头，验证：

1. 三种同步查询返回通过公开 schema 的 `businessSemantics`；fire 仍禁用，未调用发射设备接口。
2. Task 创建后实际 Execution 为 LIVE，可查询、暂停、恢复、取消并等待设备状态确认。
3. 无 mission identity 的 fresh Recon 观测触发 Provider lock，参数使用当前 Execution 最新 mission ID；ACK / stage 2 不产生 Input，命令之后同目标 stage 3 才产生 Input。
4. Input accept / decline / cancel 均通过公开匿名请求答复，审计记录 `development_anonymous`。伪造 `respondedBy` 和不同 Task subject 被拒绝；release 后等设备扫描恢复。
5. 导航经过实际受控 WebSocket planner、路线采用、暂停/恢复、调整和替换任务。错误 Execution、Intervention revision 和 plan revision 均拒绝；同 `commandId` 等值重试成功、改值冲突；有效调整必须等设备取消旧任务和新 mission 状态才采用新计划。

其他合同与故障注入进一步覆盖：deadline、RequiredInput request/revision/subject binding、strict/inferred 两种关联、retained/stale/终态/显式身份冲突、命令之后同目标的锁定确认、失联及恢复、匿名与受信身份持久化的不可改写性、旧 ledger 缺 responder 时等待原 Runtime 信封重放。

投影合同验证五类主要业务语义及 payload load 状态；保留未知原码，以 `unknown` 输出；NPC 的原未知码准入不变。相同 source 经查询、Context 和 Event 投影结果一致，inferred 来源不升级为 strict，未知状态不驱动成功终态。

具体链路记录：[V-OBS](V-OBS.md)、[V-INPUT](V-INPUT.md)。

## 发现的问题与修复

- 匿名 responder 原先在 Runtime、持久化、dispatcher 和 Provider 之间被旧验证器拒绝：统一内部来源模型，公开命令 JSON 不变。
- Input 解锁后的恢复曾拼造 user 来源：在既有 JSON command ledger 保存原受理来源并保持不可改写；旧记录不伪造来源，等待原信封重放。
- 已确认的导航暂停/恢复留下审计记录，原门槛误认为仍有待确认控制：改用已有 `controlConfirmationPending` 判定，完成控制不再阻塞路线调整，尚未确认的控制继续阻塞。
- 部分测试依赖历史 simulation 默认：需要仿真的夹具显式设置 simulation，不改变 live 默认。
- 两个 migration 升级测试把数量硬编码为 27，但基线已有 28 个 migration 文件：现在核对数据库安装的完整版本清单与实际 SQL 文件清单，无新增 migration。
- lease race 的取消命令仓库夹具缺少两个既有业务命令 supersede 方法：补全夹具并断言只有 CANCEL，未修改生产命令处理。[修复前完整运行](evidence/integration-before-fixture-fix.log)为 484 PASS、1 FAIL、25 SKIP；[修复后该项复测](evidence/lease-race-fixed.log)为 1 PASS。失败日志保留，不改写为全绿；最终扩展回归已重新完整运行且通过。
- 配置包用例先从仓库根目录运行导致相对路径错误；改用该包的正式命令运行通过。临时 PostgreSQL 就绪探测改用 TCP，避免把初始化阶段的临时 Unix socket 当作最终数据库就绪。

## 文档验证与交付边界

指南通过离线解析核对 9 个 JSON 片段、14 个 Bash 片段、17 个协议请求及 9 个工具参数；curl 被本地函数替换以捕获请求，网络请求数为 0。请求经当前冻结协议解析器、manifest 输入 schema 和 Input / Intervention 参数解析器校验；本地链接均存在；[离线示例校验日志](evidence/guide-validation.log)。当前 55 个相关实现、配置、测试和文档文件的哈希见 [SOURCE_SNAPSHOT.json](SOURCE_SNAPSHOT.json)，不包含此前 v1.2 报告和设备合同捕获。

GitHub hosted CI、镜像发布、sz-gowm 部署和新的现场功能验收未在 v1.3 执行，不标为 PASS。本 Goal 的完成结论限于任务包要求的 SMPP 实现、兼容回归和文档；部署若后续授权，应以这些未提交改动为候选源码重新构建。
