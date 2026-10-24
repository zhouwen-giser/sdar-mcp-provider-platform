# 原生 ZMQ 正式链路候选

本包提供原生 Provider → gRPC → SMPP Runtime → MCP 的隔离验收实现。
目录 profile 为 `zmq_v1_12`，不替换旧 MQTT 目录。当前原生控制只允许数字回环地址，
资格固定为 `isolated_simulator_only`。`192.168.2.63` 现场控制仍拒绝启动。

## 当前工具

| 工具                                                         | 功能                                      |
| ------------------------------------------------------------ | ----------------------------------------- |
| vehicle_get_state / vehicle_get_capabilities                 | V2 真实接收状态、资格与目录               |
| vehicle_get_payload_status / vehicle_get_targets             | V2 观测快照（来源和新鲜度保留）           |
| vehicle_zmq_navigate                                         | 单点、航点路线、返航；速度 m/s            |
| vehicle_zmq_area_recon / vehicle_zmq_circular_recon          | 四点凸区域侦察 / 环视（严格原生参数）     |
| vehicle_zmq_camera                                           | 绝对角度、缩放、有期限角速度（弧度）      |
| vehicle_zmq_inspect_area                                     | 显式椭球高的四点区域检查                  |
| simulation_apply_effect                                      | 一次仿真效果请求，必须引用有效的关联观测  |
| vehicle_get_inspection_result / simulation_get_effect_result | 身份隔离的完整接收报告分页 / 迟到补充结果 |

所有控制使用 Task-required，父期限和 300 秒上限共同约束准备、暂停及执行。
面板对原生 Provider 校验整份 12 工具目录，包括输入/输出、任务合同、业务反馈及执行语义。
原生导航、区域侦察、环视、云台使用明确显示当前 Schema 的 JSON 参数表单，服务端绑定 resourceId。

双仓库源码候选包保留已跟踪的历史合同/验证输入、公开配置模板和脚本执行位；逐文件记录
SHA-256。当前生成的验证日志单独交付，私有配置、密钥、依赖目录及未跟踪文件不进入源码包。
不支持方向距离、相对云台、测距、旧锁定/人工决策、7879 规划器及外部未关联任务急停。
已关联任务可用 tasks/cancel；效果服务无暂停/取消协议，超时仍保留独立占用。

## 构建和隔离配置

在本包的 SMPP 源码目录运行 `pnpm build`，使用 Dockerfile 的 `ugv-zmq-candidate` target。
镜像保留原生 ZeroMQ 运行依赖。`compose.formal-candidate.yaml` 所有服务均需显式 qualification
profile，不包含实际站点凭据或会自动启动的服务。

镜像回归：在 `--network none --read-only` 下加载 Provider 和原生 ZeroMQ；运行
`node dist/scripts/ugv-zmq/preflight.js` 必须完成 17 项冻结输入校验并因 G0 缺少 12 项而退出 2。
缺少合同源文件导致的文件读取错误不能计为“正确拒绝现场准入”。

Provider 私有 JSON 配置权限必须为 0600：databaseUrl、observationDatabaseUrl、profile、
observerSettings、controlSettings、host=127.0.0.1、port。profile/limits/observer 的格式来自对应
Zod Schema，测试 fixture 只能用于隔离模拟器。controllerSystemId 缺省仍为 null，禁止猜测。

先由各存储所有者安装其迁移：独立模式沿用 Provider 迁移；观测库使用
`deploy/ugv-zmq/migrations/001_observation_archive.sql` 的安装器。启动只验证，不创建 Schema。
GOWM 模式必须通过既有 owner 合同及 TaskBusiness 开启路径，不能回落独立库；原生观测档案
另用 SMPP 自有数据库。控制 Scope 包含 device/binding/service/source session，未决占用跨绑定阻塞。
本次 GOWM SQL 组件测试不等同于完整 owner 部署资格。

## 交接与历史

1. 完成 G0 原始证据和实际绑定校验，确认新镜像、Schema、目录、Skill 和 profile 的哈希。
2. 对旧 Runtime 使用既有 drain/PMS 路径关闭新准入；核实待受理、未确认任务及 Provider 执行。
3. 在旧身份域内运行只读 handoff 检查，同时确认外部 EO/效果动作及设备物理空闲。
   `databaseIdle` 只是瞬时计数，`switchAuthorized` 永远为 false，不是交接令牌。
4. 由受控发布流程停止旧写端并确认容器/连接关闭；新写端取得同端点独占租约。
   未决 native occupancy 阻塞接管，北向终态不能清除它。跨数据库写端需额外站点独占证明。
5. 新 SDAR 版本通过既有 CAS 治理后才能发布；本包的 SDAR 候选生成器不执行发布或物理动作。

保留旧 Runtime 的原授权域与目录解码器用于只读历史，勿用新 simulationId 导入旧任务后操作。
原 TaskBusiness Context 一经 finalized 不再改写；迟到效果通过独立结果页读取。
数据库卷、PMS 配置、绑定及轨迹签名密钥均不替换。回退撤回新目录/Skill 并关闭新准入，
保留历史；旧 MCP/MQTT 依赖仍须实际可用，换旧镜像本身不证明控制恢复。

## 验收范围

本地正式 MCP/native ZMQ/PostgreSQL 隔离测试与只读跨仓库目录验证有独立证据。
SDAR 实际治理发布、正式原生 Skill 任务链/巡逻后继、完整 GOWM 站点资格和现场动作仍未验收。
参见第五阶段 ExecPlan，不能以本候选包声称已完成现场迁移。
