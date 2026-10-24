# 原生 ZMQ 第五阶段：正式链路隔离增量验收

日期：2026-10-24/25。**本轮候选实现已验证；第五阶段整体仍在进行，现场未验收。**

## 固定来源

| 范围                   | 来源                                                                                                                 |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| SMPP 本轮基线          | `156c3cc6f8633da569a77479232cc6b60c164c11`                                                                           |
| SMPP 验证源码          | `2f4eeb1f57343742bec3886847e8a4892cc185ed`；逐文件 SHA-256 见 `source-inputs.json`                                   |
| 原生 Provider 镜像源码 | `655a0b725845426d2ec01216b48e3361455d9842`；39 个编译文件与本地构建逐项一致                                          |
| SDAR 验证源码          | `9cd615b4da06f91386067dec92d0116a5f77dd95`                                                                           |
| 分支                   | 两仓库均为 `codex/ugv-zmq-phase5-20261024`                                                                           |
| 镜像                   | `smpp/ugv-zmq-candidate:20261025-phase5` / `sha256:24d4a872bb600b5df0bca31e062f119cc26cb1d964d773ed86a70343cfb346c3` |

最终交付提交固定报告及状态。部署包中的 MANIFEST 固定两个最终 Git HEAD 和每个文件的
哈希、字节数、执行位；包和镜像导出哈希在包旁的 receipt，不与 Git 提交互相嵌套。

## 已实现与验证的范围

- 原生 Provider → 既有 gRPC → 正式 SMPP MCP Runtime → PostgreSQL Task/TaskBusiness/结果。
  持久身份使用新的公开工具名；原生操作、输入哈希、时序、授权及 simulation 身份单独保存。
- 独立 `zmq_v1_12` 目录，整份工具集合、输入/输出、Task Profile、业务反馈、执行语义与资源
  一致性均按冻结快照检查。冻结北向协议、迁移和旧合同未修改。
- 暂停、恢复须在 Runtime outbox 收到完整 CommandAck 身份后才记 ACKNOWLEDGED；重复受理
  返回原任务。错误输入、超期限、身份域冲突在派发前拒绝，恢复/查询不重派。
- 新检查报告保留逐帧来源，空间足迹、任务轨迹、源流完整性缺失持续降级。收到有效空帧也
  只表示接收帧中无观测。效果超时仍保持未决占用；迟到结果独立版本化，原任务与 finalized
  Context 保持原值。
- 既有 GOWM owner Scope 接口和 PostgreSQL SQL/RLS 组件测试覆盖绑定隔离及跨旧绑定占用。
  **该组件夹具不是完整 owner 启动合同或站点部署资格。**
- 面板增加四项原生 JSON 参数表单，服务端固定资源并校验完整原生目录。浏览器验证了
  参数错误拒绝、一次导航提交、期限停止确认、迟到仿真结果及完整报告下载。
- SDAR 新增精确只读消费者候选、确定性输入/父期限适配器和报告降级策略。通过真实冻结
  discovery adapter 读取上述正式 MCP 目录。**该跨仓库探针没有发布 Skill 或执行物理操作。**

工具清单及启动、交接、回退步骤见 `deploy/ugv-zmq/FORMAL.md`。

## SMPP 验证

| 检查                                     | 结果                                                                                 |
| ---------------------------------------- | ------------------------------------------------------------------------------------ |
| 封版正式链路 / 跨仓库 SDK / owner SQL    | 12 通过（含 4 项目录合同）                                                           |
| 侦察/控制及旧 gRPC/TaskBusiness/目录回归 | 134 通过（含上述 4 项目录合同，不重复累计）                                          |
| 原生 PostgreSQL 生命周期/结果回归        | 29 通过                                                                              |
| 面板 API/状态/合同/真实旧 Runtime 夹具   | 57 通过；修复 lint 后 ZMQ 子集再验 13 通过                                           |
| 浏览器                                   | 旧控制 4 通过；原生 ZMQ 2 通过                                                       |
| 双仓库实际压缩包测试                     | 2 通过：可重复字节、模板/执行位、逐项哈希、私有文件排除及漏打包拒绝                  |
| TypeScript、构建、变更文件格式与 lint    | 通过                                                                                 |
| 冻结北向协议                             | 63 个锁定文件、11 个 Schema、74 项冻结目录校验通过                                   |
| 源合同预检                               | 17 项冻结输入校验通过；12 项 G0 缺口，预期退出码 2                                   |
| Docker                                   | 模块/原生 socket 初始化通过；39 编译文件匹配；预检预期退出 2；缺少配置启动预期退出 1 |

每条命令的 argv、cwd、配置文件路径、实际/预期退出码、日志 SHA-256 见 `verification.json`。
临时配置文件未交付，已随自有模拟数据库/MQTT 清理。

### 原始证据

正式链路归类为 `ISOLATED_FORMAL_RUNTIME_SIMULATED_ONLY`：1 个接收 session，4441 项连续链记录、
4432 次接收、24 个末态来源引用、12 项不可变结果记录。解码及哈希链、来源关联
与结果版本校验均通过。原始链 SHA-256：`4440a800f4cc1c07c7f9b0232aa641e031fa5419c62d7999fc03915426f949ed`。

原生浏览器证据来自专用模拟桥接夹具；正式 Runtime 证据来自另一套真实 MCP/gRPC 夹具。
不得将浏览器夹具解释成 SDAR 正式任务链或现场接入证明。

## SDAR 完整门禁

运行 `sdar-verify-d392206e-dc0d-4ad9-ad43-f58fb94f85c2`；退出码 0、cleanup 0，runtime/baseline 输入未被执行过程
改写。使用显式 `--docker-default-bridge` 和带 ensurepip 的独立 Python 3.12.14 工具链。
验证进程固定为 8 核 CPU 亲和性，未改其他进程或测试阈值。
这只是本机验证条件；默认 bridge 共享二层网络，不提供网络租户隔离，现场不据此放行。

| 门禁                                    | 结果   | 退出码 |
| --------------------------------------- | ------ | ------ |
| format                                  | passed | 0      |
| verification-runner-contract            | passed | 0      |
| lint                                    | passed | 0      |
| typecheck                               | passed | 0      |
| unit                                    | passed | 0      |
| contract                                | passed | 0      |
| evidence-contract                       | passed | 0      |
| evidence-coverage                       | passed | 0      |
| architecture                            | passed | 0      |
| a2a-baseline                            | passed | 0      |
| management-openapi                      | passed | 0      |
| node-control-contract                   | passed | 0      |
| node-control-implementation-conformance | passed | 0      |
| smpp-registry-projection                | passed | 0      |
| acceptance                              | passed | 0      |
| sources                                 | passed | 0      |
| protocol                                | passed | 0      |
| infra                                   | passed | 0      |
| project-license                         | passed | 0      |
| licenses                                | passed | 0      |
| build                                   | passed | 0      |
| cognitive-replay-no-physical-provider   | passed | 0      |
| clean-baseline-reset-seed               | passed | 0      |
| postgres-redis-integration              | passed | 0      |
| postgres-redis-model-mcp-e2e            | passed | 0      |
| official-a2a-tck                        | passed | 0      |
| canonical-evidence-demo                 | passed | 0      |
| infrastructure-smoke                    | passed | 0      |
| server-console-smoke                    | passed | 0      |
| node-control-api-worker-smoke           | passed | 0      |

门禁内既有不适用/分组排除按原断言执行。官方 TCK 限 `http_json` / `MUST` 范围：
74 passed、161 skipped、30 deselected，不代表全部传输与全部级别均通过。
详见 `raw/sdar-full-summary.json`、完整压缩日志与固定输入清单。

## 已修复的失败及保留证据

1. SDAR 初次静态门禁发现 schema adapter 边界越界、测试文件 lint 与冻结 JSON 格式问题。
   参数校验改为已有 JsonSchemaValidator 端口注入，保留原架构门禁和断言。
2. 新建 Compose bridge 上容器内 PostgreSQL/Redis 正常，宿主机连接超时；一次自动网络还
   选择了包含现场地址的网段，诊断项目已移除。显式默认 bridge 夹具经真实宿主机探测验证，
   自有项目/卷、回环发布、测试阈值与清理要求保留；未修改宿主机代理或防火墙。
3. 首次完整重跑在 TCK 因系统 Python 缺 ensurepip 失败；独立 Python 工具链的 TCK 先通过，
   再重跑整套门禁。未减少测试。
4. 同源码一次性能测量基线窗口漂移 19.064%，超出原 15% 门槛；相对 P95 为 -6.262%、
   追加 P95 为 2.404ms。该失败保留，后续固定验证进程 CPU 亲和性再跑整套门禁。
5. 镜像内预检曾缺少源合同文件。现在镜像同时携带 17 项校验所需源字节，文件缺失错误
   不作为正确拒绝准入。最初目录 pin 测试也揭示公共输出包装差异，已按真实公开目录校验。

原失败日志与运行身份保留于 raw/attempts 及本任务外部证据目录，不以新结果覆盖旧结论。

## 交付与运行实例

交付为双仓库**部署源码候选快照及原生 Provider 镜像**，不自动部署。
历史已跟踪合同/验证输入保留；私有配置、密钥、依赖与未跟踪文件排除。新生成日志在本报告
独立存档。源码快照供审阅、构建；完整仓库门禁仍需要 Git 历史及其固定的相邻项目输入。

最终包及镜像导出：`/mnt/data/ugv-zmq-phase5-20261024/delivery/`。
receipt 同时固定最终源码提交、输入清单 SHA-256、包 SHA-256、镜像 ID 与导出 SHA-256。

已只读核实：19100 Runtime、原适配器与 19101 HTTP 面板仍使用原镜像。本任务未切换这些
实例，也不据此声明现场连续性或设备空闲。数据库卷、PMS 绑定和签名密钥未替换。
自有 SMPP 验证容器、临时凭据已清理；SDAR 验证清理见 gate run 的 cleanup 结果。

## 尚未关闭的第五阶段及现场条件

- SDAR 实际 CAS 治理、原生 Skill 正式任务链和巡逻后继组合尚未验收，当前只有非执行候选。
- GOWM 完整 owner 启动/部署合同、实际写端准入 drain 与独占交接仍需验证。handoff 计数
  `databaseIdle` 不是交接令牌，`switchAuthorized` 永远为 false。
- G0 仍缺 12 项：simulationId、Provider/resource/sourceSession 绑定、7879 策略及部署身份、
  时钟/坐标/高程、相机几何与限制、能力范围、服务实现和提供方金帧等确认材料。
  控制端 ID 按操作员要求保持缺省，不从构造样例推断。
- 当前原生控制只接受数字回环地址的隔离模拟器；192.168.2.63 控制和 19100/19101 切换仍关闭。
  现场执行与回退验收独立记录。
