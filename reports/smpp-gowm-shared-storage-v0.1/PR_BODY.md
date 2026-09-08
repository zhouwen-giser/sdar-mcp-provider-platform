SMPP Runtime 与 UGV Adapter 增加显式 `gowm-shared` 模式，共同使用 GOWM 的 `ugv_smpp`。启动验证已安装合同，不再在该模式 provision 或运行原生迁移。每实例绑定一个设备；Repository、事件、租约、恢复、幂等及 Snapshot 使用最终设备范围和键。

回执与 Mission 同事务写入，支持 Provider 先接受、MCP Task 后发布的关联；目标坐标保持真实 CRS，句柄到期保留业务历史。PMS/PM2 提供既有 GOWM secret 和 verify-only 接线。

验证：lint/typecheck/build/protocol 检查通过；252 unit、36 contract、11 config、16 shared PostgreSQL、157 受影响回归，以及双设备真实 Runtime/Adapter 软件模拟链路通过。完整测试覆盖限制见 reports/smpp-gowm-shared-storage-v0.1/FINAL_REPORT.md。

GOWM 是只读依赖，消费来源及哈希已记录；没有改 SDAR、迁移旧数据、切换现有服务或运行物理设备。
