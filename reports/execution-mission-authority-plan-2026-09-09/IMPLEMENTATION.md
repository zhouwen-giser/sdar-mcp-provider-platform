# 最新状态

2026-09-10 已继续修复、更新 Runtime 并完成真实开发导航链路验收。最终版本 855f98a18b1c，详情见 [现场验收报告](../mission-authority-site-fix-2026-09-10/README.md)。下文为此前阶段记录。

# 修复实施记录

截至 2026-09-09：实现与本地验证完成，按用户最新要求只重建部署包，等待后续统一部署。

- sz-gowm 共享模板开启 Runtime telemetry ingress，发射保持禁用（实际配置 UGV_FIRE_ENABLED=false）。配置预检拒绝收发开关、监听地址、端口和 TLS 不一致。
- Runtime 未启用的 ingress 显示 disabled；启用后必须实际就绪。
- 新导航执行记录 missionAuthorityVersion=1。终态后根据真实 PRIMARY/FOLLOWUP 回执及 GOWM LINKED 证据，按作用域生成 Mission 来源和 exact/unresolved/conflict 关系。
- 来源与关系在同一事务进入现有 provider_ops_delivery；并发领取、重启重试和幂等校验复用现有持久队列。最终关系在执行终态后产生。旧执行不回填，不改写失败 Run。
- ProviderOps recordHash 本来已排除投递元数据，无需更改哈希算法。
- SDAR Telemetry 仓库部署脚本已固化精确任务时间线视图读取授权；该外部项目变更不包含在 SMPP 包中，须由其自身部署包带入。

验证：124 项测试通过，覆盖真实本地 PostgreSQL 非超级用户权限、事务回滚、重启与并发发布、配置及 UGV 集成。exact/unresolved/conflict 已通过 Telemetry 项目实际来源契约校验；TypeScript、构建、格式、相关 ESLint、gowm-storage:check 通过。尚未进行修复后的现场导航验收。

最新包已通过 UNION_ARCHIVE_PASS，内嵌上游原始字节及摘要一致。上一轮基于旧上游的 00f1b5d7000c3528 候选部署在替换容器前中止，不能视为已上线版本；当前指针仍为 f49cbb00f8498f00。本次新包未部署。

部署包：`/home/zhouwen/web-download/sdar-mcp-provider-platform/artifacts/united/smpp-gowm-gdps-gsap-96500c83ddb3bd4f.tar.gz`

SHA256：`589ae51ddcfb673f6c193047e4192111a1b98ffba4892354f9fea71e759eee61`

GSAP SHA256：`321700fd62de81f19b3a7e1e92f2ea22ba538be5ea94aef02bc5633711f95f52`

GOWM SHA256：`62fd9970d399039df7c7c138e8534f73c294e33836f629f64e56da3a4a91eb81`
