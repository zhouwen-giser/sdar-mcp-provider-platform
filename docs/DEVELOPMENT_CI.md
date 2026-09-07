# Development Debug 的 CI

默认开发阶段的 PR 与 main push 只自动运行一套 `runtime-ci`：

- `static`：格式、lint、类型、构建、协议和 SBOM。
- `development-tests`：单元测试、配置合同测试、CI 合同检查；不访问共享仿真设备。

main 的必需检查为 `static` 与 `development-tests`，继续要求分支最新；其他分支保护不变。
生产部署、跨平台集成、完整 Runtime 与容量验证不再作为开发 PR 门禁。
原测试代码和完整工作流保留：`runtime-ci` 的完整套件可手动触发，或由 `release/**` push 触发。
`release-candidate` 仅手动触发，必须提供精确 `candidate` 提交，保留完整候选验证及元数据检查。

取消或跳过旧检查不代表通过资格验证。此调整不更改运行模式、安全语义、工具行为或任何部署实例。
