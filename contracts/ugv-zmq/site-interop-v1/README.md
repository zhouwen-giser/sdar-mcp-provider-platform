# 现场互操作合同 1

父合同是冻结的 chassis 2.1 / EO 2.3 / effect 1.0，不修改父锁、父解析器或旧目录。

`chassis-captured.json` 保留四类真实完整报文、原归档位置和独立 CRC 复核。
`chassis-site.ts` 仅在部署明确选择后接受其“有前缀，业务长度/业务 CRC”格式；仍拒绝损坏、外部设备、截断、额外字节及超限帧。
发送始终采用部署中固定的标准 2.1；兼容接收不构成发送兼容或现场运动验收证据。

`enu-reference-observed.json` 来自现场只读地图 API，由上游 PROJ 生成，作为独立于 TypeScript 实现的转换样例。
`scene-reference-source.json` 的配置 SHA256 是读取的源码配置，不是远端二进制或完整场景的认证声明。
运行时再次核对真实场景、地图、epoch 与三个独立地图转换点。

使用 `node --import tsx scripts/ugv-zmq/interop-contract.ts` 检查。
只有有意更新本合同后才使用 `--write` 固定新版本哈希；不得更新父合同来迁就现场差异。
