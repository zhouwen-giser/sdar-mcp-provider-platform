# 轨迹接收时间与历史证明验收

源码：`cfda8c7f2f651a2c81db3c0e5f169e09100a911f`。本地隔离验收通过；真实设备、现场操作、SDAR 实际互通和 19100 部署为 NOT_RUN。

最终门禁均使用相同源码输入，exit 0，运行期间源码未改变：

- m3-verify-v2-05
- m3-history-path-02
- m3-ugv-task-business-02
- m3-public-intake-03
- m3-ugv-image-open-02

提供实际 MQTT 接收时间、独立数据库记录时间、只读版本化 MCP、签名有限保留范围、稳定分页及原子坐标侧车。完整保留范围不表示物理回调全捕获，也不表示设备应产生的全部历史完整。后两者保持 unknown。

SDK、schema、例子和迁移说明见 contracts/ugv-trajectory-history/v1/README.md。详细逐项保证、测试路径、所有成功与失败命令、精确源码输入及原始日志 SHA-256 见 ACCEPTANCE.json。开发阶段失败未改写为通过；发生源码改变的旧门禁不作为最终证据。

所有旧冻结资产 75 个字节不变。设备全量证明仍需可信生产者身份/epoch、认证开始结束边界、计数或连续序号与补传语义；设备采集时间还需时基与校准合同。
