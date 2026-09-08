# GOWM / GDPS / GSAP / SMPP 联合打包与部署

2026-09-08：已部署到 sz-gowm，MCP 地址 `http://17.26.1.20:19100/mcp`。本次实际使用 GOWM 管理的账号，未创建第三套业务账号或独立数据库。

## 固定来源

- GOWM：`1ad2edcc2cbe0859e4481401e8cbc82548d35aa89ab9b688cc30caf3c1147e05`。
- GOWM/GDPS/GSAP 上游联合包：`9f19951ac4ad691e4896c2f578fd4f0351a45d458f12c5f6eb299bc52521adf2`，其嵌套 GOWM 与上述包完全一致。
- SMPP：`877221a171e6f0f7d8d1a9e248095d590e416e33-worktree-d5106be7fe47`，明确记录构建时工作树，不冒充干净提交产物。
- 本次联合包：`artifacts/united/smpp-gowm-gdps-gsap-40cd30ae5506c863.tar.gz`，SHA256 `cf1a819aba31b3a5c841b09799485e1fc12b7628f5a77b612988ec11e6316111`。

两份上游包以原始字节纳入，未修改 GOWM/GDPS/GSAP 源仓库。生成器核对上游 SHA256 和嵌套 GOWM 来源；输入版本不匹配时拒绝生成，不私自替换。

## 生成和部署入口

默认 `pnpm package:development-server` 现在生成联合包；`pnpm package:united-server` 等价。独立 SMPP 包使用 `pnpm package:smpp-server`。

实现：`scripts/package-united-deployment.py`、`deploy/united/deploy.mjs`、`deploy/united/deploy.sh`。归档包含内部 SHA256SUMS、UNION.json、三个固定输入和运行入口。已解压检查默认模式并在现场执行同一入口。

现场入口：`/mnt/data/smpp-united-current`，指向 `/mnt/data/smpp-united-releases/smpp-gowm-gdps-gsap-40cd30ae5506c863`。

```sh
ssh sz-gowm 'bash /mnt/data/smpp-united-current/deploy.sh status'
# 镜像已加载时，重复部署保留配置、账号与绑定：
ssh sz-gowm 'bash /mnt/data/smpp-united-current/deploy.sh up --prebuilt'
```

当前基础联合包已经是所需版本，因此部署入口核对 SOURCE、Compose owner 和 PostgreSQL system identifier 后直接复用。33 个运行中的基础项目容器保持 ID 和 StartedAt 不变；没有调用删卷重建或重建基础服务。若未来基础包不同，此入口拒绝越权接管，要求先按上游数据保留升级流程部署固定基础包。

## 数据库与凭据

从既有基础包 `.runtime/.../business-connections.env` 读取 GOWM 初始化提供的 `SMPP_DATABASE_URL`。使用 `ugv_smpp_app`，保留密码；SDAR 的账号仍在原私密文件，不交给 SMPP。原文件未改写，运行时不使用 GOWM 管理员账号。

部署前生成 PostgreSQL 在线备份：本 release `.runtime/before-smpp.dump`，111728022 字节，私密目录。随后调用 GOWM 镜像内的正式 `install(smpp)`，仅安装原生 SMPP 域并补充必要 Mission/目标权限。实际绑定由 GOWM API登记：`d0d6998d-6630-4b57-90a3-1facdc17ddc3`，device=`ugv:ugv`，service=`smpp.sz-gowm.ugv`。

SMPP secret 仅保存在现场 `smpp/deploy/development/server/config/gowm.url`，0600 / UID1000；没有进入源码、归档或报告。已有 secret 不匹配时拒绝，不自动重置账号密码。

## 实际验证

| 验证                                    | 结果                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------- |
| 部署配置测试                            | 5 PASS                                                                          |
| 变更部署脚本 ESLint / diff 检查         | PASS                                                                            |
| 上游输入哈希、联合包及现场归档校验      | PASS                                                                            |
| 固定归档源码构建 Runtime / Adapter 镜像 | PASS；VCS_REF 与 SOURCE_REVISION 匹配                                           |
| 应用配置启动检查                        | 两侧 PASS                                                                       |
| Runtime readiness                       | HTTP 200，数据库、Adapter、Manifest、恢复、调度、命令、事件链依赖 ready         |
| 标准 MCP tools/list                     | 10 tools，0 error                                                               |
| 运行时数据库核对                        | database=gowm，account=ugv_smpp_app，search_path=ugv_smpp,public，35 个安装条目 |
| SMPP 容器                               | 两个运行，RestartCount=0                                                        |
| GOWM/GDPS/GSAP 保护                     | 33 个原容器 ID / StartedAt 不变                                                 |

首次镜像构建因本机 Docker 桥接 DNS/代理下载 grpc-tools 超时失败；改用主机网络后成功，没有改锁文件或绕过供应链/构建检查。只传输本次构建的两个 SMPP 镜像，未删除其他镜像。

此次现场只执行就绪与只读协议验证，没有人工制造业务任务、调用导航/取消/武器或宣称物理执行成功。此前隔离环境的双设备数据库测试不算作本次现场任务链验收。SDAR 原生业务表及完整工作流仍不在本次启动范围；其登录账号保留。
