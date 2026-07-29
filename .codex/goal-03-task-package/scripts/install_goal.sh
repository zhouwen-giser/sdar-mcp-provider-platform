#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: $0 /absolute/path/to/repo" >&2; exit 2; fi
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO="$1"
[[ "$REPO" = /* ]] || { echo "Repo path must be absolute" >&2; exit 2; }
[[ -d "$REPO/.git" ]] || { echo "Not a Git repo: $REPO" >&2; exit 2; }
cd "$REPO"
[[ -z "$(git status --porcelain)" ]] || { echo "Worktree must be clean" >&2; exit 1; }
git fetch origin
BASE="origin/codex/goal-02-runtime-governance"
git rev-parse --verify "$BASE" >/dev/null
git switch --detach "$BASE"
if git show-ref --verify --quiet refs/heads/codex/goal-03-merge-readiness-foundation; then
  git switch codex/goal-03-merge-readiness-foundation
  git merge --ff-only "$BASE" || { echo "Existing Goal03 branch is not fast-forwardable; resolve intentionally" >&2; exit 1; }
else
  git switch -c codex/goal-03-merge-readiness-foundation
fi
rm -rf .codex/goal-03-task-package
mkdir -p .codex/goal-03-task-package .codex/goal-03/evidence
cp -a "$SRC"/. .codex/goal-03-task-package/
rm -f .codex/goal-03-task-package/PACKAGE_MANIFEST.json .codex/goal-03-task-package/SHA256SUMS
cp .codex/goal-03-task-package/templates/task-state.json .codex/goal-03/task-state.json
cp .codex/goal-03-task-package/templates/execution-log.md .codex/goal-03/execution-log.md
cp .codex/goal-03-task-package/templates/decisions.md .codex/goal-03/decisions.md
cp .codex/goal-03-task-package/templates/blockers.md .codex/goal-03/blockers.md
python3 .codex/goal-03-task-package/scripts/verify_goal2_state_unchanged.py .
git add .codex/goal-03 .codex/goal-03-task-package
git commit -m "chore(goal03): activate merge-readiness foundation package"
echo "Goal03 installed. Next: python3 .codex/goal-03-task-package/scripts/taskctl.py next"
