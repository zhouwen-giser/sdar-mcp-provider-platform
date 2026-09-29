# Mission 权威链路修复：已上线并完成开发导航验收

最终 Runtime 为 `855f98a18b1c`。修复来源实例身份不匹配、逐条导出积压，以及大批次超时；默认每批 10 条，优先交付真实已提交的 Mission 来源与关联。26 项相关测试、类型、静态检查和镜像构建通过。发射保持禁用，未改写旧 Run 结果。

最终 Run：`run_222b3fb8f3d63b43988d7963a46f9cfee5a4436506f7f45b5561b50a57dfe3eb`。SMPP Task `72d2d5c4-0512-43f2-89e3-6581a048689f`，Execution `vehicle:ugv:chassis:8efc31ed-7eaa-4f2d-ba1b-13554fe4ceae`，真实 Mission `41992`。

导航 SUCCEEDED；两条来源与一条关联均在终态约 2.5 秒后首次投递成功。五项作用域内 Task→Execution=1、Mission=exact、Execution→Mission=1。SDAR 权威仓库 external_provider_fact 中三条 source_record_id/hash 与 SMPP 持久记录逐一一致。跨项目负例返回零关联。详细原始响应见 smpp-final-site-audit.json。

Benchmark 已 completed，身份、就绪、确认、派发、绑定、物理到达和业务结果检查通过；required/supporting evidence 均完整。总评 not_ready 的唯一原因是 `UGV_DIAGNOSTIC_PROFILE_NOT_FORMALIZED`，不宣称正式评分通过。评估原文见 smpp-run4-result.json。

交付包：`/mnt/data/smpp-gowm-gdps-gsap-189032c35b8d9b4b.tar.gz`，SHA256 `edc01c5eb32f7d9678ef52717fe4ee7c4d225c9094c63cda84f97748b9ca0237`。

边界：本次修复及严格验收针对导航回执权威链路；高频非关键 Adapter 遥测仍可能限流/超时，未将其宣称为无损事件通路。旧积压失败记录未回填或删除，统一部署目录仍保留基线标识，实际 Runtime 镜像以最终部署记录为准。

## 调查与修复记录

2026-09-10（Asia/Shanghai）。用户完成统一部署后继续验收。

现场最初运行 96500c83ddb3bd4f / d6341a4153be，ingress ready，UGV_FIRE_ENABLED=false。首轮新导航成功，PRIMARY/FOLLOWUP 均 ACCEPTED，Mission 41989，SMPP Task 59813317-73e6-44d2-bc8f-20eab6efa7c1。但三个持久事实的 instanceId 错用了业务服务键 smpp.sz-gowm.ugv，未匹配 Telemetry v4 来源映射，导致 HTTP 400 和持久重试。首轮 Run run_16065fb29f6a1e590590c20d33b43a57f8c6221452231b6a166b0a65b60b66f2 已因 P10_CURRENT_AUTHORITY_TIMEOUT 失败，保留该结果。

修复：新生成的导航回执/关联统一使用现有注册来源 smpp-runtime-postgres-authority；正式 Runtime exporter 对已排队的 navigation_dispatch_receipt_v1 来源做相同投递元数据归一化。instanceId 不参与 canonical recordHash，不改写原队列、recordId、recordHash、occurredAt，不直接向下游写事实。

12 项相关测试、TypeScript、相关 ESLint、Docker 构建通过。使用本轮真实三个持久事实、Telemetry 实际完整 validateEnvelope 和现场 SourceMappings 校验：旧身份不匹配，修复后身份匹配，完整哈希与契约验证通过。此项补充了上一轮仅检验语义函数、未覆盖来源注册映射的测试缺口。

已定向更新 Runtime 到 c3599914785913ea107ac5394676537f7542a635-worktree-ff25ef7dbdde。原统一部署 Compose 保留，Runtime 镜像字段更新；Adapter、网络、数据库及私有配置保留。部署信息写入现场 state/runtime-source-fix-deployment.json。新联合源码包 e0fb6719e8cd346a，SHA256 3d8063486279f5c83dc6558e8b2dcb8d376dbfe7a15e09f121a0dc76a3893d7a，上传到 /mnt/data/smpp-gowm-gdps-gsap-e0fb6719e8cd346a.tar.gz。当前统一发布目录指针仍标识原基线，Runtime 修复以该部署记录为准。

首轮还观察到高频 Adapter 遥测限流/超时和积压。导航权威回执使用持久数据库出口，其恢复结果须独立核验；不能据此宣称所有高频物理遥测零丢失。

第二轮 Run run_248652c3d4f65960e866a3b964cbcc634daf69450c11ec55a8758c31e7b91b13 正在验收，最终结果待补充。

第二轮导航也成功，Mission 权威事实随后正常交付，但逐条串行 OTLP 导出造成事实积压，再次触发 P10_CURRENT_AUTHORITY_TIMEOUT。后续正常交付不改写原 Run 的超时失败。

追加修复：DurableProviderOpsPublisher 将同批领取记录通过一次完整 OTLP ACK 交付；批次失败则逐条重试隔离，未收到完整确认前不标记交付。21 项相关单测（含完整 ACK 和批次拒收隔离）、4 项实际 PostgreSQL 持久交付集成测试、TypeScript/ESLint 和 Docker 构建通过。

最新联合包：8a24db60778d2937，SMPP revision c3599914785913ea107ac5394676537f7542a635-worktree-bdee729b9e9e，SHA256 f6b7704fa0af5f79b980bbf8e326868a25c24be37aed09f6f2c1cb6c9c57db12。上传路径 /mnt/data/smpp-gowm-gdps-gsap-8a24db60778d2937.tar.gz。

第三轮 run_5e0c41a01409ce3aff91bc6da3f912e234fe9e1bedceb09ab9d29133bd5afc63 完成诊断链路，绑定、物理到达、结果检查通过，required/supporting evidence 完整。总结果 not_ready 的唯一原因是 UGV_DIAGNOSTIC_PROFILE_NOT_FORMALIZED，这是开发配置的正式资格限制，并非 Mission 缺失；未放宽该判定。

仍观察到 100 条批次在 Collector 十秒窗口超时。最终默认领取缩至 10 条，Mission 来源/关联优先于高频观测。新增 PostgreSQL 优先领取回归通过（旧观测仍可随后领取）。最终 21 项相关单测和 5 项 PostgreSQL 集成通过。

最终 Runtime revision：c3599914785913ea107ac5394676537f7542a635-worktree-855f98a18b1c；已上线，health ready。Adapter 保持原版 d6341a4153be、发射禁用。现场 state/runtime-mission-final-fix-deployment.json 记录准确镜像和包；当前统一发布目录指针仍保留原基线，未伪造整套服务均更新。

最终包：smpp-gowm-gdps-gsap-189032c35b8d9b4b.tar.gz，SHA256 edc01c5eb32f7d9678ef52717fe4ee7c4d225c9094c63cda84f97748b9ca0237。远端 /mnt/data/ 同名文件及校验文件均已上传。
