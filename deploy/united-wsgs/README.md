# SMPP + GOWM + GDPS + GSAP + WSGS 联合部署包

本包在 WSGS 已交付的四组件联合包上加入 SMPP Runtime 和 UGV Adapter。原 WSGS 联合包及其中的 GOWM、GDPS、GSAP、WSGS 归档保持原字节；`UNION.json` 固定全部校验值、版本及 SMPP 源码快照。打包同时核对 SMPP 消费的 GOWM 核心迁移、32 项共享存储迁移和三个作用域覆盖文件。

交付方式为 **联网源码构建**，不含 Docker 镜像、服务器环境文件、密码或私钥。需要 Linux x86-64、Docker Engine、支持 `env_file.required`、`up --wait` 和 `!reset` 的 Compose、Node.js 22、Python 3.12+、openssl、curl、tar、sha256sum 以及依赖和镜像源网络。默认 WSGS API 端口为 8080，SMPP MCP 端口为 19100。

## 初始化与部署

```bash
sha256sum -c smpp-gowm-gdps-gsap-wsgs-*.tar.gz.sha256
umask 077
tar -xzf smpp-gowm-gdps-gsap-wsgs-<摘要>.tar.gz
cd smpp-gowm-gdps-gsap-wsgs-<摘要>
./deploy verify
./deploy init
```

部署目录须由当前用户拥有，目录及非 sticky 的父目录不允许组用户或其他用户写入。初始化不启动容器，创建三个配置入口：

SMPP 的连接文件供容器 UID 1000 读取；部署用户应为 UID 1000，或具有将该文件归属 UID 1000 的权限。

| 文件           | 配置内容                                                                                                                             |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `upstream.env` | GOWM/GDPS/GSAP；填写真实 `UGV_MQTT_URL`、认证/TLS 文件及上游端口。完整部署 SMPP 时保留 `UGV_MQTT_INGEST_ENABLED=true`。              |
| `wsgs.env`     | 填写模型地址、密钥和名称；调整 `WSGS_API_PORT`。暂不使用模型时显式设置 `WSGS_MODEL_POLICY=MODEL_OPTIONAL`，清空三个 `MODEL_*` 字段。 |
| `smpp.env`     | 填写 `ADAPTER__UGV_MQTT_URL`、设备 MCP 与规划服务地址，必要时调整身份别名、超时和 `DEPLOY_PORT`。                                    |

三个入口是初始化后生成的本包内部相对符号链接，实际配置文件权限为 0600。MQTT 的 GOWM 和 SMPP 接入使用独立 client ID；须将两侧 broker 设置为同一实际来源。SMPP 保留 `UGV_ENTITY_ID=ugv1` 作为设备传输别名；它与 GOWM 主档 `ugv:ugv` 含义不同。

SMPP 的 Docker 项目默认派生为 `<上游项目>-smpp`，使用同一 GOWM PostgreSQL 和外部网络；不会新增 SMPP 数据库。初始化根据上游 UGV 配置设置 SMPP 的 device ID、数据范围和网络，重复执行保留凭据及用户设置。已有绑定后的 device ID 或数据范围改变时停止，防止改写旧身份。默认发射禁用：`ADAPTER__UGV_FIRE_ENABLED=false`。

```bash
./deploy config-check
./deploy doctor
./deploy up
```

先调用原 WSGS 入口启动 GOWM/GDPS/GSAP、签名 Gateway、WSGS 数据库、API 和 Worker；再复用 GOWM 的 `SMPP_DATABASE_URL`、真实数据库标识和正式 Device 绑定，备份数据库、安装 SMPP 业务迁移并启动 Runtime/Adapter。SMPP 阶段结束后核对上游容器未被重启。正常启动会订阅 MQTT、读取设备 MCP 目录；健康验证不主动派发导航、取消或发射命令。

默认在 SMPP 安装前备份 GOWM 整库。大体量已有库可以显式选择 `./deploy up --backup-scope smpp`，只备份 `ugv_smpp` 定义和业务数据，排除未被本次 SQL 修改的 `ugv_state_snapshot` 观测数据。局部备份不可作为全库灾备或用于全库替换。所有备份、连接凭据和运行记录只存部署目录，不在发布归档内。

## 维护

```bash
./deploy build-images
./deploy status
./deploy logs smpp
./deploy logs wsgs
./deploy logs upstream
./deploy smoke
./deploy down                 # 按 SMPP、WSGS、上游顺序停止；保留数据卷
```

`build-images` 构建原上游和 SMPP 镜像；SMPP 直接使用校验后的源码归档作为 Docker 上下文，标签包含 `SOURCE_REVISION`。已导入对应 SMPP 镜像时可使用 `./deploy up --prebuilt`；该选项仅跳过 SMPP 构建，上游仍按原入口运行。

保留整个部署目录，尤其是三个配置入口的目标文件和 `.runtime/`，重试部署不会旋转已有密钥。升级已有实例需使用上游数据保留升级流程；不要把新目录的随机身份或卷名套用到旧库。当前 19100 实例的配置和数据不随生成本包而改变。

轨迹历史扩展默认关闭。启用前，在数据库备份完成后通过 GOWM owner 运行 `smpp/scripts/trajectory-history/install-gowm-owner.mjs --owner-url-file /private/owner.url --apply` 安装校验固定的前向迁移（Node.js 环境需已安装源码依赖）。将持久 Ed25519 私钥保存在 SMPP `config/`，权限为 0600、容器 UID 1000 可读；在 `smpp.env` 配置 `ADAPTER__UGV_TRAJECTORY_HISTORY_ENABLED=true` 和 `ADAPTER__UGV_TRAJECTORY_HISTORY_SIGNING_KEY_FILE=/run/config/trajectory-history-signing.pem`。部署及应用启动不自动生成或轮换该密钥。扩展提供 `vehicle_get_trajectory_history` 与 `vehicle_get_trajectory_evidence` 两项只读工具；接收时间及保留范围证明不代表设备全量采集历史已经认证。

校验、初始化和 Compose 配置通过不等于现场业务验收。清单记录 `siteAcceptance=NOT_RUN`；真实模型、MQTT 数据、设备操作和五项目业务联调须在目标环境另行验收。

## 重新打包及验证

在 SMPP 源码目录使用 Node.js 22：

```bash
pnpm package:wsgs-united-server --wsgs-package /absolute/path/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz
# 也支持原联合包入口：
pnpm package:united-server --wsgs-package /absolute/path/gowm-gdps-gsap-wsgs-dev-server-0.2.1.tar.gz
python3 scripts/verify-wsgs-united-deployment.py artifacts/united/smpp-gowm-gdps-gsap-wsgs-<摘要>.tar.gz
```

SMPP 独立源码包位于 `artifacts/united/source/`；联合归档附 `.sha256`、`.build.json` 和验证后生成的 `.verification.json`。验证会解包、重复初始化、检查配置、私密文件权限及容器清单，不启动服务。
