# 本项目专属仿真视图

`simulation_adjust_view` 是独立的 Task-required 工具，发布于目录 1.4.0、
`zmq_v1_4_0_site_control_14`。对象为本项目创建的 CARLA RGB 相机，输入为
`resourceId`、`viewId`、`horizontalFovDeg` 和 `acknowledgeCameraRecreation=true`。
水平视场角以度为单位，公共范围 5–160°，还需符合部署范围。十三项原有工具保留原输入输出；
原光学倍率输入不接收新的仿真视图动作。

## 实际执行

本仓库的 `apps/simulation-view-gateway/view_gateway.py` 通过官方 CARLA Python API 创建
专属相机。服务端固定车辆 Actor、role_name、场景 episode ID、API 版本、相对姿态与分辨率。
先取得新相机的实际 FOV 及请求之后的新图像，再停止并释放旧的本项目相机。每次删除前校验
原所有者、Actor、父车辆和角色。服务不推进仿真时钟，也不修改车辆或外部光电相机。

新相机归属、实际 FOV、图像 FOV、Actor ID、场景 ID、图像帧号、原始数据 SHA256 和实际帧
缩略图进入结果及 TaskBusiness。内参由仿真属性推导，明确标记为非地理定位标定。
该视图不接入上游识别算法；报告的 `eoRecognitionAffected=false` 始终保留。

重建前写入并 fsync 命令意图。相同 commandId/内容返回原记录，不同内容拒绝。
响应丢失后只查询命令回执；重启不创建相机。不确定结果保持占用，普通光电空闲状态不能
代替视图后端对账。当前版本不支持暂停、取消重建或自动回滚已应用的视场。

## 配置与启动

网关仅监听 `127.0.0.1`，使用独立服务器 token；Provider 与服务各持有权限 0600 的 token 文件。
浏览器不能配置后端地址、CARLA 地址、车辆身份或所有者。网关状态与命令目录均需持久保存。

网关 JSON 配置字段：

| 字段                              | 含义                                                   |
| --------------------------------- | ------------------------------------------------------ |
| resourceId / viewId / ownershipId | 精确资源、视图标识和新 UUID 所有者                     |
| apiVersion / worldId              | SDK 和服务端都必须相同的 API 版本、实际场景 episode ID |
| parentActorId / parentRoleName    | 已核实的车辆 Actor 及其精确角色                        |
| carlaHost / carlaPort             | 部署固定的 CARLA RPC 地址                              |
| width / height                    | 128–1920 × 72–1080 的实际相机分辨率                    |
| minFovDeg / maxFovDeg             | 5–160° 内的部署范围                                    |
| transform                         | 相对车辆的 x/y/z 米及 pitch/yaw/roll 度，必须明确提供  |
| stateDir                          | 持久私有目录，如 /var/lib/simulation-view              |
| tokenFile / port                  | /run/secrets/simulation-view.token，未占用的回环端口   |

Provider `controlSettings` 选取新 Profile，新增 `simulationView`：
`endpoint`（回环 HTTP 根地址）、`tokenFile`、`viewId`、`ownershipId`、`apiVersion`、
`worldId`、`parentActorId`、`parentRoleName`、`minFovDeg`、`maxFovDeg`、
`exchangeTimeoutMs`（1000–10000 毫秒，默认 8000）。动作支持配置新增
`camera.simulationView`；仍需要支持依据、实时来源校验和既有 EO 租约及互斥。
这些设置改变控制 scope，须先按现有流程核实前驱任务和占用。
`worldId` 使用十进制字符串保存完整 uint64，禁止经 JavaScript number 转换。
按站点 UID/GID 创建权限 0700 的状态目录。Compose 是现有 site-control 编排的叠加文件：

```sh
docker compose --env-file /private/site-view.env -p smpp-zmq-site-control -f deploy/ugv-zmq/site-control/compose.yaml -f deploy/ugv-zmq/simulation-view/compose.yaml config --quiet
```

完成实际 SDK、车辆绑定和前驱占用验收后，才使用同一组文件更新服务。

先执行只读探测：

```sh
python3 apps/simulation-view-gateway/view_gateway.py --config /private/view.json --probe
```

成功探测不构成创建相机的现场验收。部署固定 `PYTHON_IMAGE` 到经过检查的 Python 3.10
Linux amd64 镜像 digest，再构建本项目 Dockerfile，保存最终镜像 ID。Compose 配置要求
精确匹配的站点 SDK 只读目录、token、配置和状态目录；端口冲突直接失败。

## 依赖与现场状态

标准依赖为官方 `carla==0.9.16` CPython 3.10 Linux amd64 wheel，MIT 许可，SHA256
`52b1f2fafb0655e25954f9f6d1e97c211a4da404217fd1d0094b4b7350737c95`，来源
[官方 PyPI](https://pypi.org/project/carla/0.9.16/)。自定义站点版本必须提供匹配的 SDK
并独立记录 wheel/目录哈希；未匹配时在读取场景前返回 `ZMQ_VIEW_API_VERSION_MISMATCH`。
API 依据为 [CARLA 相机文档](https://carla.readthedocs.io/en/latest/core_sensors/)。

2026-10-30 现场只读探测：RPC 可达，服务端版本 `067529e82-dirty`；标准 0.9.15 SDK
读取场景时发生本机原生异常，未取得车辆映射。当前不具备现场启用条件。
软件验证使用明确标记的隔离 CARLA API double，执行真实网关、HTTP、MCP 和 PostgreSQL。
本阶段 SDAR 保持原精确绑定，新 Profile 需另行治理后才能由 SDAR 选择。

回退关闭本服务并恢复匿名只读 Runtime；保留私有命令回执和现有 JSONB 报告。
停止服务只停止本进程的相机监听，不销毁相机，不自动恢复旧视场。
