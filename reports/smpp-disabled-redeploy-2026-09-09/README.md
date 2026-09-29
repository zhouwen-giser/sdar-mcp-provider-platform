# SMPP 禁用发射后更新部署（2026-09-09）

已基于今天部署的 GOWM／GDPS／GSAP 联合包重新生成 SMPP 包并更新 sz-gowm。实际配置为 UGV_FIRE_ENABLED=false；UGV_FIRE_DISABLED 是原因码而非环境变量。模板、生成器默认值和运行容器均已核对禁用。

- 归档：smpp-gowm-gdps-gsap-f49cbb00f8498f00.tar.gz
- SHA256：ab152101ef51009743dc8d8bcb6c25dacbccadec1c1c4feb25ee44f55e14c7bc
- SMPP 来源：c3599914785913ea107ac5394676537f7542a635-worktree-17d17b081c11
- 上游联合包 SHA256：341a14aceee94a4abc65215aa18c30a16cf20afb03c65dc4ec5ab31109202f8f
- GOWM SHA256：01b37aeb563179a7449844b93d28cccafdf507a9befffa241d7482460aab221a
- 复用新 GOWM 数据库及 ugv_smpp_app，由现有部署入口读取私密账号文件、安装 SMPP 域和绑定；不另建业务 PostgreSQL。
- Runtime／Adapter 已运行；19100/health/ready 全部依赖 ready。
- 两个旧 SMPP 容器已移除；两个专属状态卷先备份后移除重建；六个无容器引用的旧 SMPP 镜像已删除。
- 54 个其他项目容器保留，启动时间一致。其他项目卷与镜像未清理。
- 备份与远端清理记录：/mnt/data/smpp-refresh-20260909/；本轮 GOWM 在线备份另存新发布目录 .runtime/before-smpp.dump。
- 配置回归 6 项通过，相关 ESLint 和 git diff --check 通过。首次沙箱 EPERM 后，原命令在获准环境复跑通过。
- 未派发设备控制、目标跟踪或发射测试；验收范围为配置、共享存储、部署和就绪状态。
