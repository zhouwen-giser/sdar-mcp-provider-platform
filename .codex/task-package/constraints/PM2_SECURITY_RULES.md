# PM2 Runtime Adapter Security Rules

- PM2 使用 JavaScript API 或受控命令封装，不对外暴露任意命令 HTTP API。
- 只允许固定 Runtime entry、固定 cwd 根目录、平台命名空间进程名和环境变量白名单。
- Fork Mode；一个 Runtime 副本一个 PM2 Application。
- `online` 仅是进程状态，ACTIVE 必须同时满足 live、ready、身份校验和 Catalog。
- 默认禁止管理非 `sdar-runtime-*` 进程。
- Start/Stop/Restart/Delete/Inspect 必须幂等并记录 Audit。
- Secret 不写入 ecosystem 文件；只注入受控文件路径。
- 数据库切换停止全部副本后执行，不使用普通 rolling reload 造成双 Task Authority。
