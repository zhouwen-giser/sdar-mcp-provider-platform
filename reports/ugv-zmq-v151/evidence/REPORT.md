# ZMQ 1.5.1：本项目互操作修复与候选验收

## 范围与结论

依用户最新授权，仅修改 SMPP 隔离工作树。仿真端保持 `a0be6a5`，未修改或重启；SDAR 未修改。现场设备控制派发 **0 次**。

底盘接收与 7879 V2 规划两个原阻塞均已通过真实只读验证。候选为回环 `19110/19111`，正式 `19100/19101` 尚未切换。24 小时稳定性和最终任务空闲/写端交接仍是发布门禁。

## 源码与合同

- 应用/镜像源码：`ada745829c635b9bb56d6017c2c2faf7f31e544e`。
- 最终集成测试源码：`22a35551b0d9ea7d3f328dc839558bd604540b8b`；与应用源码仅差 `tests/ugv-zmq-control-postgres/simulator.ts`。后续监控脚本与交付文档不改变应用镜像。
- 新南向互操作合同 SHA256：`0e2df6125e060d997cdc9eedd986cd2863592fbcecc6bb7210c7b47627efa2f5`；原始 2.1/2.3 合同及旧目录仍冻结。
- 独立目录：`zmq_v1_5_1_readonly_15` / `zmq_v1_5_1_site_control_15`，保留 15 项工具；候选只启用前者。
- 旧主目录、上游源码和正式容器身份见 `protected-state.json`；账号/授权凭据 SHA256 与配置挂载保护见 `candidate-handoff.json`。

### 底盘

部署 schema `/3` 明确选择 `prefix_business_length_crc`，核对四字节业务长度、实际长度、业务 CRC、消息/设备身份，保存原始帧与诊断。观测标记为 `2.1-site-rx/1`，`standard21Conformance=false`。严格 2.1 仍拒绝相同非标准帧；没有探测或解析失败后的协议回退。发命令仍固定 `prefix_wire_length_crc`，未据接收格式推断发送格式。

### 7879

每次从同一连接读取新鲜 V2 设备/控制器/epoch/mission 上下文，核对场景、地图与 GNSS 转换，仅发送带唯一请求 ID 的 `plan_route`。校验 ACK、请求 ID、epoch、上下文稳定性及 ENU 几何，输出 `ugv.zmq-route-preview/2`、`preview_only`。来源/上下文变化明确拒绝，不补造身份、不创建导航任务。

当前现场为 `yuan_qu`，参考纬度 `22.506858333333`、经度 `114.048222222222`、参考椭球高 `500 m`。旧机场坐标不可用于此场景。地图配置文件哈希是配置来源证明，不声称远端地图二进制得到独立摘要认证；二维路线参考高度也不标为实测高度。

## 软件门禁

所有命令、源码、实际退出码、日志 SHA256 均在各 `attempt-*/*.json`。配置只引用私有文件路径，不发布凭据。

| 验证 | 最终证据 | 结果 |
| --- | --- | --- |
| 类型检查、Lint、构建、冻结 MCP、南向合同与各代目录 | `attempt-1/`，类型及模拟器 Lint 补验在 `attempt-3/` | 退出 0 |
| 相关单元与 manifest 漂移 | `attempt-1/unit.*` | 171 通过 |
| PostgreSQL / 原生 ZMQ / MCP / 帧与归档 | `attempt-3/postgres.*` | 124 通过，1 项外部 SDAR fixture 未配置跳过 |
| 严格 1.5.0 控制、兼容 1.5.1 控制 | `attempt-3/v15-control.*` / `v151-control.*` | 各 10 通过 |
| 面板类型检查/构建/测试/浏览器 | `attempt-1/console-*`、`attempt-3/console-tests.*` / `browser.*` | 80 项及 1 个浏览器用例通过 |
| Manifest 编译内存有界、镜像内无网络合同校验 | `attempt-1/manifest-memory*`、`image-contract-smoke.*` | 通过 |

保留初次失败：隔离测试配置未含必需 owner/brokerUrl；兼容控制回归曾因模拟器并行 PUB 写入触发 EBUSY。配置补齐后面板重测通过；测试模拟器按 publisher 串行化后，受影响的全部 PostgreSQL/两代控制/面板/浏览器测试重测通过。未隐藏失败或将其计为通过。未重复运行无变化且已通过的应用门禁。

## 真实候选与面板

- `candidate-handoff.json`：先停止旧候选，按依赖创建新候选；保护五个凭据文件、数据库配置、PMS 配置及 runtime-state 挂载。所有部署命令退出 0；正式实例未操作。
- `candidate-live.json`：精确 15 项目录、匿名域、伪造身份头忽略、无效 JWT 拒绝；三路真实订阅及新鲜底盘定位；归档 running 且无丢弃；接收会话边界明确记录。
- `candidate-route-preview.json`：真实 V2 请求、原始响应、上下文、ENU 转换、哈希及九点路线，保持预览、尚未采用。
- `candidate-console-live.json`：HTTP 登录、640×480 原图与 SHA256 下载、真实 V2 规划和报告下载、两条历史任务、过期任务留存报告只读、移动布局、零页面异常。曝光 UTC 未知、未观察到同帧检测框均如实展示。
- `live-command-receipts.json`、`commands/`：执行脚本副本、实际命令、退出码与结果哈希。`planner-direct.json` 保存独立只读直连规划证据。

本验收不证明现场运动已通过。原图/规划也不替代实际轨迹、覆盖或发现流完整性。光学变焦、next_follow 等原限制不因本次兼容而消失。

## 固定镜像

三个镜像 revision 标签均为应用源码 `ada7458`，构建日志在 `attempt-1/images-build.*`。

| 角色 | 镜像 ID |
| --- | --- |
| Provider | `sha256:b1a92b1c166bda4a2af7dfc7cb2fda6122e2f12aa42dbddc100455a026a5471e` |
| Runtime | `sha256:26f3f21764e813a02a7f4728ad2610e3a2bf6e8e528f0fe108f13941da27e1a7` |
| Console | `sha256:4a65816fb5e9ad1a04ada741e57174c31d1ae0ab7dd4295e423581da49dbe3eb` |

这些 ID 也固定于交接及稳定性 run.json，不以可变标签判定连续性。部署包仍标记未通过现场控制资格、禁止自动部署。

## 24 小时门禁与后续

第三轮实际开始：**2026-11-12 18:20:30.763833 Asia/Shanghai**。最早实际满 24 小时：**2026-11-13 18:20:30.763833**。

运行目录：`/home/sz/.smpp-debug/zmq-v15-20261112/stability-24h-3`。启动快照在 `stability-3-launch/`，是运行中证据，不是通过证明；诊断单样本在 `stability-diagnostic-3/`，同样不能计作 24 小时。样本日志形成 SHA256 前向链，摘要绑定已确认前缀；当前实际摘要为后续状态依据。

每分钟检查容器 ID/镜像/启动时间、重启/OOM、HTTP、归档、明确接收合同及定位；每十分钟核对只读 V2 规划与原图。现场专项结果与稳定性分别记录，断流或空载不能证明现场可用。监控只允许四项只读工具，不会派发运动或生命周期操作。

第一轮及 `superseded-ca33761/` 的第二轮均在满 24 小时前撤换，不拼接时长。旧正式 Runtime 仍是旧镜像，已有历史重启；其状态不能替代新候选门禁。

待完整连续运行通过后，重新核实正式实例任务、未确认命令、占用和写端租约；满足交接条件再执行已授权的正式切换。真实运动继续由操作员确认。回退采用理解当前接收变体的只读镜像，保留所有任务、归档、报告、绑定和审计；不恢复旧 MQTT 写端。心跳继续监控，状态不变保持安静。

## 证据完整性

`SHA256SUMS` 覆盖本目录证据（不递归包含自身），原始图像未长期复制。隔离测试容器及其匿名卷按精确 ID/任务标签清理，见 `test-cleanup.json`；生产数据库卷未动。操作说明：`deploy/ugv-zmq/v151/README.md`。部署包独立回执位于 `reports/ugv-zmq-v151/package-receipt.json`（生成后记录）。
