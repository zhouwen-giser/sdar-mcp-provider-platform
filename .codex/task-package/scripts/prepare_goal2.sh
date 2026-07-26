#!/usr/bin/env bash
set -euo pipefail
PKG="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${1:-.}"; REPO="$(cd "$REPO" && pwd)"
python3 "$PKG/scripts/verify_goal1_handoff.py" --repo "$REPO"
cd "$REPO"
mkdir -p .codex/archive/goal-01
cp .codex/task-state.json .codex/archive/goal-01/task-state.json
cp -a .codex/handoff/. .codex/archive/goal-01/ 2>/dev/null || true
rm -rf .codex/task-package
mkdir -p .codex/task-package
cp -a "$PKG"/. .codex/task-package/
if git show-ref --verify --quiet refs/heads/codex/goal-02-runtime-governance; then git checkout codex/goal-02-runtime-governance; else git checkout -b codex/goal-02-runtime-governance; fi
python3 .codex/task-package/scripts/init_state.py --goal goal-02 --repo .
git add .codex
git -c user.name='Codex Bootstrap' -c user.email='codex-bootstrap@local' commit -m 'chore: activate provider platform goal 02' || true
echo 'Goal 2 activated. Run: python3 .codex/task-package/scripts/taskctl.py next'
