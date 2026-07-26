# Configuration and Secret Rules

- 配置键：`environment + targetType + targetId + configGroup + dataId`。
- 继承：instance > deployment > provider > provider_type > environment > default；不可变字段禁止覆盖。
- Apply Mode：`hot_reload | reconnect_required | restart_required | immutable`，默认保守选择 restart_required。
- 冷启动依赖 Bootstrap Config；PMS 不可用时 Runtime 使用 LKG。
- Publish Revision 不可变，使用 canonical JSON + SHA-256；相同 checksum 不产生新 revision。
- Secret 只保存 SecretRef，进程只接收 `*_FILE` 路径；文件权限 0600。
- API、日志、审计、错误详情、测试快照不得出现明文 Secret。
- 数据库/Adapter Endpoint/端口切换不得伪装成热更新。
