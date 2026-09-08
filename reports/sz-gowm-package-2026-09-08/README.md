# sz-gowm SMPP 部署包

本次根据已部署 GOWM 现场配置生成源码部署包。使用 sz-gowm 本机的现有 Docker 网络及 `postgres:5432/gowm`，两个应用统一写入 `ugv_smpp`。没有替换 GOWM/GDPS/GSAP 容器，没有在现场安装 Schema、创建角色、启动 SMPP 或连接设备进行控制。

## 现场只读核对

- 引用的 GOWM 部署任务及部署记录已读取。
- GOWM 部署包摘要：`33a72b038d7d4e4f8589c4048534391457b1e47a047061253e95bb59f631cbf6`，正式迁移至 079。
- 现有 PostgreSQL：`gowm-analysis-dev-d2bf0ea98e-postgres-1`；数据库 `gowm`；业务 Schema `ugv_smpp` 尚未安装。
- 网络：`gowm-analysis-dev-d2bf0ea98e_default`。
- 设备 `ugv:ugv`，scope `default`，MQTT `mqtt://192.168.2.63:1883`，现场尚无 SMPP binding。
- 现有角色包含 `gowm_device_reader`，但无 SMPP 登录角色。包内准备入口复用该角色并创建专用 `smpp_gowm_runtime` 登录；不会使用运行时管理员连接。
- 部署镜像内执行本包的只读 bootstrap 预检通过，实际 SMPP 安装条目/overlay/core 哈希匹配。

## 包装与配置

`--site sz-gowm` 归档包含现场配置、初始化入口、部署说明及 `DEPLOYMENT_PROFILE`。解压后的默认入口强制共享模式；compose 仅有 Runtime/Adapter 和状态卷，不创建数据库容器或数据库卷。两个应用加入既有网络、共享配置目录的 `gowm.url`；真实 binding UUID 由 GOWM API 登记后产生。

新增 `prepare-gowm.mjs` 默认只读，`--apply` 才调用现有 GOWM 正式安装器、完成专用登录/权限及已有设备的消费者绑定。密码仅在服务器本地生成和保存（0600 / UID 1000），管理员连接只在 GOWM 容器内使用。已存在角色没有对应 secret 时拒绝继续，不轮换密码。准备入口不启动消费者，不要求安装 SDAR 或 vector。

修复了 UGV/runtime Docker 基础层未包含 `contracts/gowm-shared-storage` 的问题；三个相关镜像基础层现在都复制该合同。新增角色测试支持把 admin fixture 连接和真实 application 登录分开，验证普通角色业务访问。

## 本次新增验证

| 检查                                               | 结果            |
| -------------------------------------------------- | --------------- |
| 部署模板与共享配置回归                             | 5 PASS          |
| GOWM 现场只读合同/设备预检                         | PASS            |
| Runtime / Adapter 本地 Docker 构建                 | PASS            |
| 非 root Runtime 镜像合同读取与共享配置加载         | PASS            |
| 隔离库调用真实 GOWM 安装器/设备 API/角色 bootstrap | PASS            |
| bootstrap 重放保持同 binding 和密码                | PASS            |
| 专用普通登录 PostgreSQL Repository                 | 16 PASS         |
| 专用普通登录双设备源码 Runtime E2E                 | 1 PASS          |
| 变更文件 ESLint、typecheck、diff whitespace        | PASS            |
| 解压后默认配置/归档排除秘密与运行数据              | PASS，1596 文件 |
| 两次生成的归档 SHA256                              | 一致            |

数据库测试只使用本任务专用隔离数据库；未复用历史管理员测试作为普通登录验证。完整结果在 `role-integration.json`。现场尚未执行 `--apply` 和 `up`，未验证设备 MCP 的在线合同；未声称现场业务流已切换。

## 产物

- `artifacts/smpp-sz-gowm-877221a171e6-f236f5b2f48b.tar.gz`
- SHA256：`f59e9230d4ee9273f3f85e29595c8395c1660f2786e874063827ce093e910855`
- 来源为 `877221a171e6` 基线加本次工作树，归档 SOURCE_REVISION 明确标记 worktree 摘要；未声称干净提交产物。

使用步骤：`deploy/development/server/GOWM_SZ_DEPLOYMENT.md`。
