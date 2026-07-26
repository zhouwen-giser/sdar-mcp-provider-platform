# Initial Repository Setup

## 1. 前置条件

- Linux 或 WSL2；
- Node.js `>=22 <23`；
- pnpm `>=11 <12`；
- Python 3.10+；
- Git；
- Goal 2 执行 PM2 集成时需要 PM2 与 PostgreSQL；Goal 1 的大部分任务不依赖 PM2。

## 2. 推荐自动初始化

在任务包目录执行：

```bash
bash scripts/validate_package.sh
bash scripts/bootstrap_goal1.sh /absolute/path/to/sdar-mcp-provider-platform
```

脚本执行：

1. 校验源 ZIP SHA-256：`000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3`；
2. 解压唯一顶层目录；
3. 初始化 `main` 分支并提交原始离线基线；
4. 将任务包复制到 `.codex/task-package`；
5. 初始化 `.codex/task-state.json`、日志、决策和 Handoff 目录；
6. 创建 `codex/goal-01-platform-foundation` 分支；
7. 不自动执行 `pnpm install`，避免网络/缓存条件影响基线导入。

## 3. 手动初始化（自动脚本不可用时）

```bash
sha256sum inputs/source/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip
# 必须等于 000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3
mkdir -p /tmp/provider-platform-source
unzip inputs/source/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip -d /tmp/provider-platform-source
cp -a /tmp/provider-platform-source/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1/. /path/to/sdar-mcp-provider-platform/
cd /path/to/sdar-mcp-provider-platform
git init -b main
git add .
git commit -m 'chore: import offline runtime provider baseline'
mkdir -p .codex/task-package
cp -a /path/to/this-package/. .codex/task-package/
git checkout -b codex/goal-01-platform-foundation
python3 .codex/task-package/scripts/init_state.py --goal goal-01 --repo .
```

## 4. 首次环境盘点

Codex 必须记录但不得擅自升级：

```bash
node --version
pnpm --version
git status --short
pnpm --version
```

随后按 `G1-P0-B01` 运行离线包既有门禁。网络依赖不可用时不得修改 lockfile 伪造安装成功。
