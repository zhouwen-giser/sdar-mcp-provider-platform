# 纯软件仿真服务器部署

## 生成部署包

```bash
pnpm package:development-server
pnpm package:development-server --output-dir /absolute/path/to/output
```

也可从任意目录执行 `node /仓库路径/scripts/package-development-server.mjs`。
打包机需要 Node.js 22、Git、GNU tar；无需Docker，不构建或部署服务。
默认输出仓库 artifacts/ 下源码 `.tar.gz`、`.sha256` 和来源 `.json`；
`--output-dir` 支持相对调用目录或绝对路径，`--help` 查看参数。

脚本先检查.env.example与配置schema一致性，再打包当前工作树，包含未提交源码；
包名记录base revision及源码内容/权限hash。相同输入重复生成的压缩包SHA256一致。
自动排除.env、运行数据、token、常见密钥及报告，不跟随符号链接；
请仍检查源码中没有硬编码凭据，文件名过滤不等于秘密扫描。
临时版本文件只写入独立临时目录，不覆盖仓库文件。
模板漂移时先审查配置变更，再运行
`node deploy/development/server/package.mjs generate-template` 更新模板。
在输出目录用 `sha256sum -c 文件名.tar.gz.sha256` 校验，解压到空目录后部署。

## 部署

要求 Linux、Node.js 22、Docker Engine/Compose v2+、网络可拉取公共镜像和 npm 依赖。
在隔离开发内网执行 `bash deploy/development/server/deploy.sh up`。
本项目镜像现场构建，公共基础镜像在线拉取。首次复制 `.env.example` 到 `.env`，以后绝不覆盖。

命令：`up`、`status`、`logs`、`down`、`config`；第二参数可指定环境文件绝对路径。
`down` 保留数据库卷；本包不提供自动删库命令。端口冲突不会接管或删除其他实例。
默认 MCP `0.0.0.0:19100/mcp`，南向指向192.168.2.63，仅使用 live 传输；没有 mock 回退。

全部阶段免调用凭证，仅用于用户确认的纯软件仿真。绝不可暴露公网或连接真实武器。
`DEPLOY_STAGE` 可选 development_debug（默认）、integration_candidate、qualification；
阶段名称不代表认证通过。可直接改该值启动，其他配置不需额外解锁。
MCP/diagnostics/启用的管理接口免调用凭证；数据库密码仍保留，数据库和Adapter不映射宿主端口。
`SIMULATOR_CREDENTIAL_FREE` 为显式仿真免凭证选项；关闭后原token要求恢复。
不会取消幂等、参数验证、诊断租约scope/TTL或一次派发约束。

## 环境变量

唯一输入是指定环境文件（默认本目录.env），不source shell、不继承宿主同名配置。
RUNTIME__/ADAPTER__前缀去除后直接传入对应进程；模板从配置schema生成，包含全部四组schema项。
DEPLOY_STAGE是Adapter阶段唯一来源，覆盖ADAPTER__UGV_DELIVERY_STAGE。
其他未填写项由应用schema默认值兜底；可选项保持注释，勿填无效空字符串。
模板注释列出类型、范围、默认值、敏感属性；修改后up重新建容器生效。
高级文件放入本目录持久config/，容器路径填/run/config/文件名；目录只读挂载到两服务。
文件必须允许容器UID1000读取；不要将真实密钥放入发布包或Git。
PMS自动注册不在此最小包启用；不会继承历史/tmp凭据或伪造注册。
state/compose.json包含本地数据库配置，权限0600，不应提交或共享。
state/identity.json仅记录非secret镜像身份和启动时间。

启动先实际加载两侧配置，再启动并等待readiness；不调用导航、车辆状态、diagnostic或fire。
可用工具受远端注册目录和实时可用性影响，开放权限不伪造健康/业务成功。
