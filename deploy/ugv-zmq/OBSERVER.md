# ZMQ 第二阶段：只读观测服务

此应用订阅三套已冻结协议，保存接收记录并提供独立只读诊断接口。默认地址 `http://127.0.0.1:19102`；它与既有 19100 Runtime、19101 控制面板分别运行。控制端 ID 可以缺省，SUB 接收不使用发送方 ID。

## 启动

使用 Node 22、pnpm 11，安装锁定依赖。生产接收驱动使用 `zeromq@6.8.0`；平台原生模块可用性须在目标镜像验证。

```bash
pnpm install --frozen-lockfile
# 在服务端安全配置 UGV_ZMQ_OBSERVATION_DATABASE_URL；不要提交凭据文件。
# 由数据库 owner 显式安装独立 schema：
pnpm db:ugv-zmq-observer
# 之后以获得该 schema 必要 DML 权限的运行账号启动：
pnpm dev:ugv-zmq-observer
```

配置文件：`UGV_ZMQ_DEPLOYMENT_PROFILE_FILE`（默认 `deployment.candidate.json`）、`UGV_ZMQ_OBSERVER_SETTINGS_FILE`（默认 `observer.settings.json`）。路径相对仓库根目录。`UGV_ZMQ_OBSERVER_DURATION_MS=6000` 可运行一次 6 秒有界观测；允许 1000～60000ms，未设置则持续运行。SIGINT/SIGTERM 会先关闭订阅，再完成有界存档和会话关闭。

安装命令只管理 `deploy/ugv-zmq/migrations/` 的独立观测 schema，不修改旧迁移。应用启动检查安装版本及校验和，不执行 DDL。迁移修改应追加新版本并实现升级流程，已安装版本不静默覆盖。数据库 URL 仅由服务端环境提供；HTTP 接口不接受上游地址、数据库地址或写入命令。

部署到共享数据库时，应由 owner 审核独立 schema/角色与容量：运行账号需要 schema USAGE，安装历史 SELECT，分区/会话 SELECT、INSERT、UPDATE，接收归档 SELECT、INSERT。接收表 UPDATE/DELETE 被触发器拒绝；运行账号不应有 DDL/TRUNCATE/DELETE 权限。此阶段已验证独立 PostgreSQL，尚未向既有 GOWM 托管池安装或授予权限。

## 只读接口

| 路径                                           | 内容                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `/health`                                      | 接收/存档状态与通道诊断；存档失败返回 503                            |
| `/v2/state`                                    | `ugv.vehicle-observation-state/2.0`，仅使用已确认存档的数据          |
| `/v2/capabilities`                             | `zmq_contract` 来源清单及未资格化原因，控制可用性为 false            |
| `/v2/schemas`                                  | 新观测 DTO 的 JSON Schema                                            |
| `/v2/storage`                                  | 本分区规范化载荷预算用量，以及整个观测 schema 的实际 PostgreSQL 大小 |
| `/v2/sessions?limit=50`                        | 当前诊断分区会话，最多 100 个                                        |
| `/v2/receptions?sessionId=…&after=0&limit=100` | 会话内有界分页，最多 200 条，按不可变序号续读                        |
| `/v2/receptions/:sessionId/:ordinal/raw`       | 分帧原始字节 base64、长度及哈希                                      |

非读取方法拒绝。会话及游标必须合法，查询固定在本实例分区。分页固定当次读取的会话高水位，不把随后追加的条目混入该页；页面和原始字节读取均校验链/帧摘要。证明类型为 `local_hash_chain_unsigned`，没有宣称来源签名或完整源端历史。

## 数据和诊断含义

- 分区包含显式诊断名称、完整 profile/合同摘要、执行域、设备端点及绑定。缺失 simulationId/Provider/资源等绑定时，数据标为 `unqualified_diagnostic`；不会发布为已资格化 Provider 状态。新场景/reset 应由可信部署配置给出新绑定，重连不代表新仿真运行。
- 每次平台进程使用新的接收会话及单调时钟身份；来源启动代次始终保留未确认。原生 mission/task/request 引用仅作为来源字段，`runtimeTaskId=null`。
- `receiptFresh` 只描述最近一次有效、已存档接收。`sourceFreshness=unverified` 单独显示；TCP 连接、重复报文和刚建立订阅都不能证明源端数据是新产生的。
- 周期设备状态正常时，定位和目标报告仍分别诊断。缺少定位或报告会明确给出 `POSITION_NOT_OBSERVED` / `TARGET_REPORT_NOT_OBSERVED`，不将通道在线当作这些数据已经存在。
- 自驾 uint64 时间原样保留，时间基准、高程基准、姿态参考不推断转换。JSON 发布时间用于检查偏差、重复和回退；未来异常时间不会污染正常时间水位。
- 所有送入应用的重复/迟到/非法报文保留；其状态投影按诊断规则拒绝或保留未知。图像报告缓存仅在当前接收会话内检查最近 4096 个 frame/topic 身份，不宣称全历史去重。
- 识别列表为空、采集时间未知、位置未知、来源截断及 `coverage_complete=false/null` 均原样保留。未关联的结果不会归入当前 SMPP 任务；没有地理位置的识别项不生成位置。
- 断线、异常会话前身、本地溢出和存储失败会形成缺口或失败记录。源端发布丢失数与连续性无法从此协议证明，保持未知。存储不可用时，`failureRecorded=false` 明确指出失败标记未确认落库。
- 原始分帧完整时逐帧可取回；超过 16 帧、140000 总字节或单帧 70000 字节的应用输入明确记为 `rawComplete=false`，不以摘要冒充完整原文。libzmq/HWM 无法观察的上游丢失仍属未知。

## 负载、保留与故障

内存队列同时限制条数和规范化字节，含在途数据库批次。数据库事务受期限限制；队列满或载荷预算耗尽会停止订阅并记录失败，不继续显示完整证据。回执丢失的写入保留未确认，不自动重写；重启保留原会话历史并记录未正常结束的前身。

`maxArchivePayloadBytes` 默认 1GiB，限制同一分区累计的规范化 JSON 载荷字节。它包含 base64、元数据和规范化数据，**不是** PostgreSQL 行/索引/TOAST/WAL/副本或磁盘上限。一个有界失败标记可使用保留额度。`/v2/storage` 同时显示整个 schema 的实际大小；该物理值包含其他分区，不应标成本分区大小。

此版本采用追加保留，不自动裁剪。应在实际部署确定物理磁盘告警、保留时长、可验证归档及容量上限后才持续运行；原始定位输入约 100Hz，面板 1Hz 投影不能作为入口容量估算。当前 500 条/约 5 秒回环负载测试只验证此环境的短时链路，长期容量与归档验收属于 G5。

## 验证

```bash
pnpm test:ugv-zmq
pnpm test:ugv-zmq-observer
# 配置文件为受限权限的 JSON，包含 databaseUrl；使用隔离数据库。
SMPP_ZMQ_TEST_CONFIG_FILE=/absolute/path/test-config.json pnpm test:ugv-zmq-observer:postgres
pnpm typecheck
pnpm build
```

本阶段不资格化导航、相机动作、检查完整报告、仿真效果、停止确认及新旧发送者交接。G0 的剩余提供方约定和后续发布门槛继续适用。
