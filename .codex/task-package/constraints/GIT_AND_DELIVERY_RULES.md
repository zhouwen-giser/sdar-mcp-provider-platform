# Git and Delivery Rules

- 保留来源 ZIP SHA、初始 baseline commit 和迁移路径映射。
- 每任务推荐一个提交；提交信息含 Task ID。
- 不重写已发布 Migration、协议锁或已有验证报告。
- 不提交 node_modules、dist、大型日志、数据库数据目录、Secret 文件。
- 阶段完成生成 phase report；Goal 完成生成 Handoff、验收矩阵和最终交付报告。
- 工作树中出现与当前任务无关的用户修改时保留并记录，不擅自回退。
