# 操作与部署说明

## 当前服务器

- 正式只读面板：`http://17.26.1.20:19101/`。
- 本机控制候选：`http://127.0.0.1:19111/`。
- 沿用原操作员账号。凭据仍在服务器原私有目录，不包含在部署包内。
- 候选仅回环开放；在其他电脑上可通过现有 SSH 连接转发 `19111:127.0.0.1:19111`。

现场动作按已确认方案由操作员发起。目前软件及订阅读取通过，六项动作尚未执行验收。

## 逐项操作

1. 登录候选，确认目录为 `1.2.0`、三路状态新鲜，并阅读具体控制参数的可用性原因。
2. 导航分别验证单点、实际路线和返航；记录速度、避障、模式回显、Task ID、任务反馈与停稳证据。
3. 云台分别验证绝对角度、倍率、100–1000 ms 角速度租期；记录回执、动作结果和真实状态。
4. 区域侦察/检查输入四点凸 WGS84 区域，明确填写已确认的椭球高。经度在前，纬度在后；不要把未确认高度当作 0。
5. 环视分别选择所需周扫/扇扫参数，记录暂停、恢复、取消及结果。
6. 仿真效果分别验证设备观测目标和人工目标。人工目标填写标识、位置和来源说明；未知高度保留未知，不冒充设备观测。
7. 预览采用前重新生成路线。采用操作引用已存预览，后台校验五分钟有效期和新鲜起点，提交实际规划点为独立导航任务。
8. 每项保留 Task ID、命令回执、报告及缺失证据。检查扫描执行通过与完整检查报告通过分别登记。

停止按钮使用独立通道，只取消本控制端已接管任务，逐组件显示确认。仿真效果协议没有停止能力。
取消回执、HTTP 200 或 MCP completed 不能单独证明业务成功。未知结果需要对账，不自动重发运动命令。
对账必须选择原未知任务、具体组件及处置原因，并提供当前新鲜空闲证据。

## 部署包

包内包含当前三个固定镜像、已验证的旧只读镜像、源码、compose、操作说明及验收证据。
私有数据库 URL、JWT 密钥、操作员凭据、交接 grant 和完整现场配置另外保留在服务器。

```sh
sha256sum -c SHA256SUMS
docker load -i images/site-control.tar.gz
docker load -i images/rollback-readonly-1.1.0.tar.gz
```

新服务器须配置本项目的既有 GOWM 受限角色、观测库、面板库、设备绑定、PMS 和轨迹密钥。
先安装并核实必要存储合同；应用启动只校验结构。不要修改冻结迁移或复用现场身份进行隔离测试。
详细参数见同目录 `README.md`。本机配置位于 `/home/sz/.smpp-debug/zmq-site-control-20261026/`，权限 0600。

## 候选与正式切换

候选配置 `site-images.env`，正式只读配置 `formal-readonly/site-images.env`；
正式控制配置已经准备为 `formal-control/site-images.env`，尚未启动。
这些文件固定 image ID，不能向浏览器提供其中的服务器凭据。

正式切换前先完成 `acceptance.json` 的现场记录；未确认或不完整项分别列明。
切换还要求当前候选无活动任务、无等待输入、无持有占用、无不确定接纳或未完成派发。
有未知占用时先完成审计对账，保留原结果。

正式切换时依次关闭候选准入并停止候选三项应用，复核数据库空闲，释放原生端点租约。
停止正式只读的 Runtime/Provider/面板，保留内部 PMS 网关；使用正式控制私有配置重建这三项应用。
不得让两个控制 Provider 同时运行。启动后核实匿名访问、可选 JWT 严格验证、精确目录、来源会话、三路新鲜状态、PMS 注册和历史报告。

```sh
docker compose --env-file /private/formal-control/site-images.env -p smpp-zmq-site-formal -f deploy/ugv-zmq/site-control/compose.formal.yaml config --quiet
docker compose --env-file /private/formal-control/site-images.env -p smpp-zmq-site-formal -f deploy/ugv-zmq/site-control/compose.formal.yaml up -d --force-recreate --no-build --pull never runtime provider console
```

这里的 `/private` 必须换成已核实的私有配置路径。上面的启动命令只在现场验收和空闲交接完成后使用。
直接 `up` 不能替代前述交接检查。

Runtime 使用宿主网络的 19100，面板 HTTP 19101，Provider 回环 7010，管理回环 19108。
内部 PMS 网关保留旧 Runtime 的 Docker 名称与 8080；原 PMS 注册 URL 通过 hosts 解析到同一 API。
重建 PMS 容器后要复核其地址、目录凭据作用域、数据库通道和注册心跳。

## 回退与保留

关闭控制准入，核实或处置未决结果，停止控制写端，再恢复已验证的只读配置。
可以使用当前固定镜像的 site_readonly 模式，或包内旧只读镜像配合对应旧配置。
保留数据库卷、原始观测、任务报告、审计、PMS、账号及签名密钥；旧 MQTT 写端保持退役。

观测档案当前每分区 64 GiB。定期核实 `archive_partition.canonical_bytes` 和磁盘容量，
接近上限时安排容量或归档；不能通过删除原始证据或伪造来源连续性释放占用。
面板 JWT 按私有部署记录轮换，保持原 tenant/subject/authority key；PMS 目录凭据从服务器密钥生成短期 JWT。
