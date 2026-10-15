# UGV trajectory reception history 1.0

本扩展为新轨迹坐标提供 Provider 接收时间及可验签的保留记录范围。
Frozen MCP 2026-07-28、TaskBusiness 1.0-rc2、BusinessEvents 1.0 和既有 GeoJSON 不变。
源版本、原始验证日志及文件 SHA-256 见 `reports/trajectory-time-history-v1/ACCEPTANCE.json`。

## SDAR 接入

1. 从 `tools/list` 检查 `vehicle_get_trajectory_history`，确认输入
   `historyVersion.const = "1.0"` 及本目录 schema。需要坐标映射时再检查
   `vehicle_get_trajectory_evidence`。旧服务、禁用配置或缺失扩展一律降级为 unknown。
2. 沿用既有身份认证、资源授权和 simulation 边界。证据查询另需原导航任务的
   `taskId`、`executionId`、`artifactId`、精确 revision；其他调用者、任务和设备不得混用。
3. 独立配置部署方提供的 Ed25519 公钥及预期 Provider/resource/device/stream 范围。
   指纹是 SPKI DER 的 SHA-256；目录描述中的指纹仅用于核对。
   不接受证明自行提供的公钥，不将示例公钥当作部署公钥。
4. 第一页指定 `resourceId`、`historyVersion` 和可选的 `fromSequence`、
   `throughSequence`、`limit`、`maxPageBytes`。默认从 1 到当前已提交水位。
   范围包含被拒绝、无位置和重复接收帧；`retainedEntryCount` 不是设备唯一采样数。
5. 保存整份签名 manifest。续读只提交 `pageCursor` 和相同 resource/version。
   游标绑定调用者、快照、流及查询限制；有效期七天。期间新增记录不改变已有快照。
6. 使用 `sdk/proof.js` 的 `RetainedHistoryVerifier` 验签后逐条 `accept`，在
   最后一页调用 `finish(rangeReadFinished)`。必须核验全部 count、序号、链边界和摘要。
   `nextCursor = null`、`rangeReadFinished = true` 或单独的摘要均不足以证明完整。
7. 对每个轨迹 Artifact 调用证据工具，用 `sdk/projection.js` 的
   `verifyProjectionEvidence` 核对独立读取的精确 Artifact。`points[i].reception`
   包含所选坐标对应的真实接收记录标识、接收时钟和链引用；需要整条链时按引用范围查询。
   裁剪后侧车仍保留已有时间映射，原记录的链读回可因保留期失效。

最小查询：

```json
{
  "name": "vehicle_get_trajectory_history",
  "arguments": {
    "resourceId": "vehicle:ugv1",
    "historyVersion": "1.0",
    "fromSequence": "1",
    "limit": 64,
    "maxPageBytes": 65536
  }
}
```

工具是 SYNCHRONOUS，只读；不增加设备控制、重放或执行授权。时间/序号查询范围
以 Provider 流为单位。源绑定改变后需重新核对 stream；不能用新绑定越权读取旧绑定。

## 三种完整性

| 字段                      | 含义                                     | 当前保证                                                   |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| `retainedHistory`         | 指定 Provider 已提交序号范围内的保留集合 | 无缺口且全部验签/验链后可 complete；裁剪/缺口为 incomplete |
| `providerCaptureCoverage` | 所有物理回调是否全部持久化               | unknown；提交前崩溃窗口不能由数据库序号排除                |
| `deviceGenerationHistory` | 设备应产生的全部采样是否完整             | unknown；生产者 epoch 与可信开始/结束边界未提供            |

第一种 complete 不升级后两种。设备全量历史仍需生产者提供可验证的身份/epoch、
明确采样范围与期望计数或连续序号、签名/认证的开始结束水位、缺口/重复/迟到及
断连补传语义。设备采集时间另需原始时钟 owner、单位、时基与校准/同步质量。
本版本不凭 `header.seq` 或 Provider 自增序号制造这些证明。

## 字段来源与质量

| 字段                          | 实际来源                                         | 解释                                                                                        |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `receptionId`                 | MQTT message 回调创建 UUID                       | 接收身份，重复投递也保留新身份                                                              |
| `providerReceivedAt.utc`      | 同一回调入口 `Date`                              | UTC，毫秒分辨率；同步未经验证，绝对误差界未知                                               |
| `processMonotonicNanoseconds` | 同一进程 `hrtime`                                | 纳秒单位的顺序辅助；不是跨进程 UTC 精度                                                     |
| `recordedAt`                  | PostgreSQL 插入时钟                              | UTC，六位小数；不是收到消息或准确 COMMIT 时刻                                               |
| `exactTransactionCommittedAt` | 未取得                                           | null，不伪造提交时间                                                                        |
| `capturedFromRecordingTime`   | 首次流创建的数据库时钟                           | owner 明示；入口接收证据从版本 1.0 / 序号 1 开始                                            |
| `reportedTime.rawValueJson`   | 本条消息解码后的字段值                           | 明示 decoded provenance，不是原始 wire 字节/数字词法；超限为缺失，unsafe numeric 为 INVALID |
| `reportedTime.unit/timeBase`  | 字段类型及已知格式                               | ROS/微秒不猜 epoch；ISO 仅作 UTC 毫秒词法转换，未校准                                       |
| `deviceAcquisitionTime`       | 生产者合同未证实                                 | null；接收时间不升级为设备采集时间                                                          |
| `sourceReportedSequence`      | 本条 header.seq / seq                            | 未证明 producer epoch；跳变、回退和重复仅为诊断                                             |
| `originalMessageSha256`       | 原始 MQTT wire 字节                              | 摘要精确保留；reference 是摘要标识，不是原始字节下载 URL                                    |
| `position`                    | 有限、版本化的 Provider normalizer               | 仅本条消息显式坐标，CRS84；拒绝帧不继承旧位置                                               |
| `reportedMission`             | 本条消息显式 Mission                             | 缺失为 null；执行归属未获设备证明                                                           |
| `missionBinding`              | Provider 新鲜当前 Mission 和唯一活动导航执行     | 侧车投影关联，与设备消息自报归属分开                                                        |
| `points[].reception`          | 与 Artifact/Context/Event 同一事务的真实记录引用 | 新坐标可链接；旧/未入账坐标 null，时间 unknown                                              |

接收范围只包含 `/ugv/gnss`、`status/ugv1`、`status/ugv`、`/ugv/status` 的位置源入口。
当前轨迹投影仍采样、合并静止点并分段；它不是完整接收日志。
历史 Context/Event/Artifact 时间不回填到旧坐标。回退时钟、重复、迟到、retained
投递、原始设备身份拒绝等诊断随每条记录保存；恢复计数为整个流的累计诊断。

## 证明规则与 SDK

SDK 仅包含公开模型及验证逻辑，不包含私有表访问。Node 22，Zod 版本固定在
`sdk/package.json`；来源文件 SHA 在 `sdk/SOURCE_INPUTS.json`。消费者也可独立实现：

1. Canonical JSON 只接受 JSON primitive、有限 number、数组和普通 object。
   key 按 JavaScript UTF-16 顺序排序，值用 ECMAScript JSON 编码，UTF-8 转字节。
   不接受 undefined、Date、非有限数。序号均为十进制字符串，最大 PostgreSQL bigint。
2. scopeHash = SHA-256(canonical(scope))。entryHash = SHA-256(canonical({algorithm,
   scopeHash,sequence,previousHash,receipt,recordedAt}))。
3. 用外部可信 Ed25519 公钥验 canonical(manifest)；base64url 必须规范且签名 64 字节。
   核对 schema、版本、预期 scope、边界、计数、非裁剪完整性、chainAlgorithm。
4. 依次核对每条序号、previousHash 和重新计算的 entryHash。最终计数必须相等，
   terminalHash 必须相等，且该范围读完。跳号、乱序、删改、换设备/范围、伪 key 均拒绝。
5. 侧车签名覆盖 canonical(evidence)，验证 Artifact 身份、revision、几何 hash 和
   每个 index/coordinate；需要链证明时再次核对 reception 引用的 entryHash/范围。

JSON Schema 不表达所有语义约束；不得省略 SDK 中的 bigint 边界、完整性、序号顺序
和终止 hash 检查。合法签名只表示可信 Provider 的声明，不能替代生产者全量边界证明。

`examples/` 提供完整保留范围、缺口范围和旧坐标未知时间三个 SIMULATED 正式模型。
示例使用公开 RFC 8032 测试向量。全部真实设备验收、现场读写及重新部署均为 NOT_RUN。

## 迁移、启用、恢复与回退

- 默认 `UGV_TRAJECTORY_HISTORY_ENABLED=false`；旧数据库、旧目录和旧工具保持兼容。
- Native 使用新的 `migrations/providers/ugv/033_trajectory_reception_history.sql`。
  不覆盖既有 030/031/032；可重复运行，旧记录和几何保持原值。
- GOWM 由现有 owner 显式安装 `deploy/gowm-trajectory-history/031_trajectory_reception_history.sql`。
  前置是原 TaskBusiness 030。新安装器校验字节 SHA、安装标记、事务回滚、RLS 和应用角色；
  重试恢复最小权限。Provider 启动仅核对安装，不执行 DDL 或降级到 native。
- 从私有 owner URL 文件预检，然后 review 后使用同一工具 `--apply`：
  `node scripts/trajectory-history/install-gowm-owner.mjs --owner-url-file /private/owner-url`。
  owner URL 文件须无组/其他用户权限。此工具不能从普通运行时账户调用裁剪。
- 由 operator 创建并持久保存 Ed25519 私钥，导出并独立分发公钥；私钥路径配置为
  `UGV_TRAJECTORY_HISTORY_SIGNING_KEY_FILE`，文件 0600，非符号链接。
  启用须 postgres 且 pool 至少 2（一个长期 writer lease）。不在启动时生成/轮换 key。
- 配置 `UGV_TRAJECTORY_HISTORY_MAX_PENDING`（默认 256）限制待入账数量。
  持久化成功后才接受状态/坐标并确认 MQTT。失败关闭本次连接，保留失败或 unclean
  恢复诊断；修复后重启。不能声明未提交窗口或断连无丢失。
- 重启保持同一流、持久 key 和合法快照。key 轮换需显式管理信任更新；旧 key 的游标
  会失效。不能静默换 key 后仍声称旧快照可续读。
- 保留期由表 owner 调用 `ugv_trajectory_history_prune(scope_hash,through)`，事务中保存
  裁剪水位/锚点并删除前缀；已裁剪范围的旧游标失效，新查询明确 incomplete。
  新保留后缀可独立验证。侧车不随原始记录裁剪；过期快照在裁剪时清理。
- 行为回退是关闭 feature 或启动旧服务；保留新表、历史和 key。无删除历史的 down migration。

复现命令及具体输出以验收矩阵的 command/exit/rawLog/SHA 为准。
配置示例、owner SQL、SDK、schema 与示例均可在部署前审阅。
