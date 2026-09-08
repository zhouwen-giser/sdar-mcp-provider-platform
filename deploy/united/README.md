# GOWM + GDPS + GSAP + SMPP 联合部署

此包固定原字节的分析联合包、同一版本 GOWM 包和本次 SMPP 源码包。生成器校验 SHA256，并拒绝分析联合包中嵌套 GOWM 与指定最新版不一致。密码不在归档中。

生成：`pnpm package:united-server`。可用 `--analysis-package`、`--gowm-package` 和 `--output-dir` 指定输入；默认取相邻仓库正式发布目录。

在 sz-gowm 将包解压至新目录，使用：

```sh
node deploy.mjs verify
bash deploy.sh up --base-root /mnt/data/gowm-analysis-current
bash deploy.sh status
```

部署入口核对既有基础联合包 SOURCE、Compose 所有权与数据库物理标识；当前基础包与本包固定输入一致时保留全部上游容器，不重复重建。若基础版本不同，入口拒绝自动接管，需先按上游已审查的数据保留升级流程安装本包内 `upstream/analysis.tar.gz`；本入口不调用上游的删卷重建选项。

SMPP 从基础包 `.runtime/.../business-connections.env` 读取 `SMPP_DATABASE_URL`，使用 GOWM 创建的 `ugv_smpp_app`。SDAR 账号仍保存在原私密文件，不传给 SMPP。若已有 SMPP secret 不一致则拒绝，不重置密码。配置仅存服务器目录，secret 为0600/UID1000。

首次写入前生成在线 PostgreSQL 备份，然后调用 GOWM 正式 SMPP 域安装器、补充必要的 Mission/目标访问权限，并通过 GOWM API 获取真实服务绑定。只启动 SMPP Runtime/Adapter，共用 GOWM database。完成后核对上游容器 ID 和启动时间保持不变。没有旧库删除、数据同步或设备控制探测。

`node deploy.mjs build-images` 可在构建机编译两个带 SOURCE_REVISION 标签的镜像；传输这两个镜像后，现场 `up --prebuilt` 会校验标签并跳过构建。默认 `up` 在现场构建。构建输出日志不包含业务密码。

本包的 SMPP 端口为19100，独立 MQTT client ID为smpp-sz-gowm-ugv。保留原有范围与设备 ugv:ugv；新消费者身份为 smpp.sz-gowm.ugv。正常启动会订阅 MQTT 并读取设备 MCP 工具目录，不会为验证主动派发导航、取消或武器命令。

`bash deploy.sh` 会复用 sz-gowm 已安装的 Node 22（含 nvm 路径）；使用 docker 组内的 sz 用户即可，不需要 sudo。

本 sz-gowm 配置面向已确认的纯软件仿真：默认 UGV_FIRE_ENABLED=true，仍要求有效锁定目标和单次发射确认。侦察、同目标跟踪与发射共享光电任务上下文，不先取消侦察。设备侦察CmdResEnum成功值为1，失败值为2。默认设备MCP超时15秒、Runtime到Adapter超时60秒；遥测经runtime:7002接收。
