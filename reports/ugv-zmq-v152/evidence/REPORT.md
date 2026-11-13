# 1.5.2 路线预览现场验收

## 结论

**路线预览修复已部署正式服务并通过只读验收。** 面板 `http://17.26.1.20:19101/`，匿名 MCP `http://17.26.1.20:19100/mcp`。源码和三镜像固定为 `47770101e2950045bc8fb37a50c8c95d258dc4d3`；当前目录为 `zmq_v1_5_2_site_control_15`。

## 原因与合同

实测 `/api/simulation/map/assets`、场景名及三个 GNSS 转换样本均对应 `yuan_qu`。上游运行管理器将整体 DEGRADED 发布为场景 failed，尽管新鲜 runtime 仍明确开放 `scene` 和 `motion:ugv`。原适配器要求场景 phase=ready，随后将此拒绝归为 `UGV_PLANNER_SCENE_UNAVAILABLE`，面板错误地描述成坐标参考无法核实。

只读源码核对 `isr-simulation@a0be6a51e17fb9e85bc4ba0b62f7157a1b77c82e`：

- `runtime_owner.py:set_phase` 的整体阶段映射不等同于每个组件都关闭。
- `RuntimeAdmission.allows` 按新鲜身份、accepting_commands 和 ready_control_groups 判断。
- `RuntimeControl.snapshot` 仅暴露 2 秒内收到的运行状态；场景快照也有新鲜度约束。
- `combined_dashboard.py` 的 `plan_route` 核验上下文并计算候选路线，不派发导航。

因此新增显式部署 /4、1.5.2 精确目录和预览 /3。新准入要求运行 available，owner/run/epoch 与场景一致，阶段 RUNNING 或 DEGRADED，scene 与 motion:ugv 开放且 accepting_commands=true。地图、三点 ENU、同连接新鲜设备/任务上下文、ACK、请求 ID 及路线几何校验继续执行。场景加载/切换、组件关闭、身份缺失或冲突一律拒绝。整体降级事实保留在 `plannerAdmission`；没有将 failed 改写为 ready。

父合同原字节和旧目录保留，哈希 `0e2df6125e060d997cdc9eedd986cd2863592fbcecc6bb7210c7b47627efa2f5`；新合同为 `cb1b6ecec5999a4edc075c7c78da0e4198706ad4baffe71dadb409873bf6cd8c`。SDAR 的旧精确绑定不能自动接纳新目录。

## 软件验证

| 范围                                         | 通过 |
| -------------------------------------------- | ---: |
| 新旧 Dashboard 适配器、分项拒绝及上下文/几何 |   38 |
| 精确目录、旧哈希与部署约束                   |    4 |
| PostgreSQL、原生 ZMQ、正式 MCP 只读互操作    |   11 |
| 新控制目录的隔离任务回归                     |   10 |
| 面板版本、命令持久化与重复提交               |   11 |
| 合计                                         |   74 |

类型检查、变更源码 Lint、后端/面板构建、冻结 MCP、新旧南向锁、新旧目录生成检查均退出 0。实际命令、退出码和已保存日志见 `software-verification.json`、`gates-final/`。测试期间使用隔离回环设备与独立 PostgreSQL；不是现场控制验收。初次 Schema tuple 表达、测试断言 Lint 和私有准备脚本模块导入失败均如实记录，修复后最终门禁通过。

## 现场验证与交接

1. 14:52，修复适配器在真实 7879 返回 5 点路线（`direct-probe.json`）。
2. 15:06，固定三镜像在 `19110/19111`、独立数据库、无命令传输器的只读候选通过浏览器登录、5 点预览、报告下载、原图和移动布局（`candidate-browser.json`）。
3. 四个原始定位样本跨 148 ms，速度均为零；场景与 V2 设备上下文 epoch 一致（`source-preflight.json`）。
4. 写端交接使用 plan/apply/verify、唯一 commandId 和快照哈希；活动任务、待处理命令和占用为空，退役任务为零。仅替换本项目 Provider、Runtime、Console（`handoff-*.json`、`cutover.json` 及日志）。
5. 旧接收会话 `8239e0ce-900f-49bb-9357-230c96774ec3` 已 closed，持久 ordinal `119256`、head `5dc65c25c657f71bcdc412f03adc6878ad00fd782a0cf3c0138a74413d21e8cb`。新会话 `820fe511-bd30-4db2-9734-a763dc9d34eb` 显式记录此前边界及断档；没有重放未确认批次或清除旧水位（`receiver-tail.json`、`formal-mcp.json`）。
6. 15:10，正式匿名 MCP 通过目录、无效 JWT 拒绝、忽略伪造身份头、三路新鲜数据、健康归档、精确原图分块校验及 5 点预览。局域网面板通过同样的预览、报告下载、原图、历史任务读取和移动布局（`formal-mcp.json`、`formal-browser.json`）。
7. 三个命令端点独占锁由新写端持有；本轮没有派发运动或仿真效果（`writer-locks.json`）。临时候选已移除，独立 PostgreSQL 已停止并保留卷（`cleanup.json`）。

当前上游仍报告 `failed/DEGRADED/dashboard`，原因是其本机 Dashboard watchdog HTTP 检查超时。新报告和面板如实展示；本轮只证明所需组件已开放且只读规划可用。光学变焦不支持、仿真视场后端未配置、底盘来源纪元/时钟未认证及完整覆盖/轨迹证据边界继续保留。现场动作和完整业务报告没有被计为通过。

## 固定镜像

| 角色     | 镜像 ID                                                                   |
| -------- | ------------------------------------------------------------------------- |
| Provider | `sha256:36d18a47a08c29da489aca627853a7e86d79f65250fcc48642e5fb90ee3cb5c4` |
| Runtime  | `sha256:35319451a9570ac9375f28b659599e7834ea177b6ab3165748cd6a403bd8ba4d` |
| Console  | `sha256:17d464551bcab979bea0806a881ccd1cd072692a09f04adb6a3c230c9ed946f5` |

构建命令、退出码和日志哈希见 `images-build.json`。账号、绑定和数据库配置沿用原私有文件，轨迹目录继续原路径挂载；证据不包含凭据。原历史任务通过 HTTP 200 再次读取，具体读取回执及报告哈希见 `history-preservation.json`；不将导出包装的哈希声明为业务对象永久哈希。

新镜像只做本次相关软件和现场只读验收；此前操作员接受缩短的稳定性观测仍为历史记录。本次不宣称重新满 24 小时，也没有恢复已暂停的自动监控。全部证据的 SHA256 在 `SHA256SUMS`。
