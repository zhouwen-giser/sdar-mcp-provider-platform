# 1.5.2 正式部署与回退

正式版本于 2026-11-13 15:10 Asia/Shanghai 验证完成。HTTP 面板 `19101`，匿名 MCP `19100`，15 项工具。地图固定为 `yuan_qu`；路线输入使用该场景的 WGS84 经纬度，不沿用此前机场坐标。

私有目录：`/home/sz/.smpp-debug/zmq-planner-scene-20261113`。凭据仅在服务器文件中保存。三个镜像固定到源码 `47770101e2950045bc8fb37a50c8c95d258dc4d3`，详见 `reports/ugv-zmq-v152/evidence/images-build.json`。

## 当前配置

```bash
docker compose --env-file /home/sz/.smpp-debug/zmq-planner-scene-20261113/formal/site-images.env -p smpp-zmq-site-formal -f deploy/ugv-zmq/site-control/compose.formal.yaml -f /home/sz/.smpp-debug/zmq-v151-formal-20261113/formal/pms-readonly-override.json -f /home/sz/.smpp-debug/zmq-v151-formal-20261113/formal/resources.json config --quiet
```

仅对 Provider、Runtime、Console 操作，保留 PMS 兼容网关。后续重建必须先核实任务、未确认派发、占用和现有写端身份，再执行管理交接；不要在运行中的接收会话上重复执行已封存的切换脚本。

## 预览操作

1. 刷新面板并登录原账号，核对“当前地图：yuan_qu”。
2. 填入新鲜当前位置或人工输入起点，目的地使用本场景经纬度。
3. 点击“预览路线”，查看规划点、来源和组件准入。上游整体降级时保留其阶段及原因。
4. 下载预览报告。预览保持“尚未采用”；设备动作由操作员单独发起并接受实际参数检查。

`UGV_PLANNER_COMPONENT_UNAVAILABLE` 表示上游明确关闭所需组件，`UGV_PLANNER_ADMISSION_UNAVAILABLE` 表示运行证据缺失/过期，`UGV_PLANNER_SCENE_NOT_READY` 表示加载、切换或停止等非运行阶段。地图、ENU、设备及 epoch 冲突各自有独立诊断。

## 回退

已准备支持现行南向协议的 1.5.2 只读配置 `rollback/provider.json` 和 `rollback/site-images.env`。它移除控制引擎、管理控制入口和命令传输器，继续历史及规划/取帧读取。

实施回退前先关闭新任务准入并核实空闲，停止当前 Runtime/Provider；记录当前已关闭接收会话的持久边界，并更新只读配置的 `recoveryPredecessor`。再使用同一 Compose、只读 env 文件启动三个服务。保留原账号、卷、绑定、审计及轨迹目录，不恢复旧 MQTT 写端。

## 2026-11-13 16:14 源重启处置

当前 Provider 为源码 `1a014d46ed94f6dd6845dc28201678f22fc3c387`、镜像 `sha256:a33f44c2cdeb789a27c71578e9254426f631342bd6d4432cc6bdfb8a6ed185b2`。Runtime 镜像未变，Console 采用此前 `cf5b0ae` 镜像。实际私有配置位于 `/home/sz/.smpp-debug/zmq-navigation-stale-20261113/formal/site-images.env`；原 canonical env 已同步指向新配置和交接凭据，不应重新运行旧切换脚本。

底盘源时间回退不会自动放行。维护时先核实空闲、未确认命令、车辆静止及已确认的源变化，经既有 plan/apply/verify 停止旧写端并取得已关闭前驱尾部。在新的唯一诊断分区配置 `recoveryPredecessor.partitionHash/sessionId` 及 `boundaryReason=source_restart_operator_reconciliation`，以新镜像启动；该分支严格要求相同 profile、合同及完整组件配置。保留旧归档、断档记录和来源未认证标记。

此新增可选配置不能交给不支持它的旧镜像解析。回退只读时使用支持该配置的新镜像，先封存当前接收会话并按上述流程建立新的只读接收边界；不要覆盖运行会话或恢复旧 MQTT 写端。本轮软件验证、正式恢复和实际导航失败分别记账，见 [报告](../../../reports/ugv-zmq-source-recovery/evidence/REPORT.md)。

只读回退配置已生成，尚未执行。临时只读候选与独立数据库的启动验证见验收报告。旧 1.5.1 部署包和合同按历史版本保留，本修复以固定源码、镜像及本记录为交付依据。
