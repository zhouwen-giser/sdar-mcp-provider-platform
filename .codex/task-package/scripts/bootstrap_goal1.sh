#!/usr/bin/env bash
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-}"
[[ -n "$TARGET" ]] || { echo "Usage: $0 /absolute/target/repo"; exit 2; }
TARGET="$(mkdir -p "$TARGET" && cd "$TARGET" && pwd)"
bash "$PKG/scripts/validate_package.sh"
if [[ -n "$(find "$TARGET" -mindepth 1 -maxdepth 1 -print -quit)" ]]; then echo "Target is not empty: $TARGET"; exit 3; fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -q "$PKG/inputs/source/sdar-mcp-tasks-provider-runtime-ugv-npc-provider-v1-work-delivery.zip" -d "$TMP"
SRC="$(find "$TMP" -mindepth 1 -maxdepth 1 -type d | head -1)"
cp -a "$SRC"/. "$TARGET"/
cd "$TARGET"
git init -b main >/dev/null
git add .
git -c user.name='Codex Bootstrap' -c user.email='codex-bootstrap@local' commit -m 'chore: import offline runtime provider baseline' >/dev/null
mkdir -p .codex/task-package
cp -a "$PKG"/. .codex/task-package/
git add .codex
git -c user.name='Codex Bootstrap' -c user.email='codex-bootstrap@local' commit -m 'chore: install provider platform codex task package' >/dev/null
git checkout -b codex/goal-01-platform-foundation >/dev/null
python3 .codex/task-package/scripts/init_state.py --goal goal-01 --repo .
git add .codex
git -c user.name='Codex Bootstrap' -c user.email='codex-bootstrap@local' commit -m 'chore: activate provider platform goal 01' >/dev/null
echo "Initialized repository: $TARGET"
echo "Next: cd '$TARGET' && cat .codex/task-package/CODEX_MASTER_PROMPT.md"
