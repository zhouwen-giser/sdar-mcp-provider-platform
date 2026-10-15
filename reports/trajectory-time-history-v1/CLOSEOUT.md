# 轨迹接收时间与历史证明交付

状态：本地实现及隔离验收完成。源码冻结提交 `cfda8c7f2f651a2c81db3c0e5f169e09100a911f`。
源码输入 SHA-256：`659356cc403c54f0acc6f0b134e72c6cca23c6ffcefb25e84c78c44a17c6ec35`。

## 实现

- MQTT 回调入口保留原始接收身份和 Provider UTC 毫秒时间，早于解析、过滤及轨迹投影。
- 单独记录 PostgreSQL 记录时间；准确 COMMIT 时间、未获证明的设备采集时间和旧轨迹点时间保持 null/unknown。
- 只读工具 `vehicle_get_trajectory_history`、`vehicle_get_trajectory_evidence`；稳定有界分页、外部可信公钥验签、有限保留范围验链及原子坐标侧车。
- Native 新迁移 033；GOWM 新 owner 扩展 031，启动只验证安装。旧冻结资产 75 个字节不变。

## 实际验收

`m3-verify-v2-05` 完整命令退出码 0，源码未改变。最终五项门禁均绑定相同源码；命令、日志与 SHA 见 `ACCEPTANCE.json`。

| 分类                   | 通过数 |
| ---------------------- | -----: |
| 单元                   |    308 |
| 合同                   |    369 |
| 集成                   |    546 |
| 恢复                   |      9 |
| 安全                   |     55 |
| E2E                    |     10 |
| 轨迹专项               |     54 |
| UGV 本地 TaskBusiness  |    425 |
| 完整 GOWM TaskBusiness |     12 |
| owner/部署回归         |     16 |

实际 MQTT、PostgreSQL、gRPC/HTTP MCP、SIGKILL 重启、broker 断连、裁剪和生产镜像 GOWM 打开均已在隔离环境通过。此前失败未改写为通过。Adapter conformance 通过；Runtime 的资源安全认证仍为部分范围。

## 包与核验

正式包：`artifacts/trajectory-history/smpp-trajectory-history-cfda8c7f2f65.tar.gz`。
SHA-256：`7ae25a2bce05972581e7012f4cff4542741c7c2e28cf393d268278cfc5049b9a`。

包包含 SDK、schema、三类示例、owner SQL、冻结源码、验收矩阵及原始日志。182 个包内文件和源码归档的解包字节核验通过；四项测试数据库凭据扫描无匹配。失败旧包已隔离。最终源文件完整保留环境模板。

仅删除了四个事先核对身份及所有者的任务测试容器；ID 消失检查通过。源码工作树和原有联合部署包保留。没有执行本次功能的远程发布或 19100 部署。

## 保证边界

完整仅指已提交、指定序号范围内的保留集合。物理回调捕获覆盖和设备应产生的全量历史保持 unknown；需可信生产者身份/epoch、认证开始结束边界、计数或连续序号及补传语义。设备采集时间还需明确时基、clock owner 和校准质量。

真实设备验收、现场操作、SDAR 实际互通及 19100 更新均为 NOT_RUN。
