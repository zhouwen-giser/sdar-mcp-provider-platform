# 证据索引

- `REPORT.md`：中文验收报告、交接阻塞和后续入口。
- `acceptance.json`：机器可读验收状态、逐能力准入、真实来源与镜像身份。
- `source-delivery.json`：代码提交与逐文件源码 SHA256。
- `verification-final-2/`：完整通过的 13 项命令、源码快照与日志；`verification-final-1/` 保留首次格式失败。
- `supplemental-verification.json`：后续历史／MCP／面板／浏览器验证记录与复现命令。
- `field-probe.mjs`：实际 HTTP 登录、已有报告读取与单次真实规划探针。凭据只从私有目录读取。
- `raw/site-device-final.json`：三路订阅、定位、来源时间、目标缺失与逐能力阻塞项。
- `raw/site-browser-final.json`、`raw/site-browser-plan-final.json`、`raw/site-console-final.png`：实际浏览器 19 点路线及页面。
- `raw/site-plan-attempt-1.json`、`raw/container-field-acceptance.json`：先前 MCP／API 的 11 点真实路线；后者包含历史读取修复前的缺失结果。
- `raw/container-restart-and-history.json`、`raw/site-legacy-context-readonly.json`：重启后原报告可读、只读 Context 查询未改写历史。
- `raw/site-history-handle-status.json`：已过期终态 handle，不能作为可读历史验收通过。
- `raw/site-handoff-final.json`：真实受限 GOWM 只读交接检查（退出 2，未切换）。
- `raw/container-deployment-final.json`、`raw/image-source-verification-delivery.json`：运行容器、挂载与镜像文件校验。
- `raw/protected-primary-status.txt`：受保护主目录未提交文件状态。
- `logs/`：初始失败、修复和最终验证的日志，均保留。
- `evidence-manifest.json`、`SHA256SUMS`：归档证据文件的精确哈希。

`../ugv-zmq-site-readonly-20261026.delivery.json`（生成后）记录包身份与发布分支；它位于包外，避免交付物哈希循环。
