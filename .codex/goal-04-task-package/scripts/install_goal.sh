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
BASE="origin/codex/goal-03-merge-readiness-foundation"
git rev-parse --verify "$BASE" >/dev/null || { echo "Goal03 remote branch is required" >&2; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git show "$BASE:.codex/goal-03/task-state.json" > "$TMP/goal03-state.json" || { echo "Goal03 task-state missing" >&2; exit 1; }
python3 - "$TMP/goal03-state.json" <<'PY2'
import json,sys
s=json.load(open(sys.argv[1],encoding='utf-8'))
bad=[k for k,v in s.get('tasks',{}).items() if v.get('status')!='PASSED']
if bad: raise SystemExit('Goal03 not complete: '+', '.join(bad))
if len(s.get('tasks',{}))!=7: raise SystemExit('Goal03 task count unexpected')
PY2
git show "$BASE:.codex/goal-03/handoff.json" >/dev/null || { echo "Goal03 handoff missing" >&2; exit 1; }
git switch --detach "$BASE"
if git show-ref --verify --quiet refs/heads/codex/goal-04-production-lifecycle-closure; then
  git switch codex/goal-04-production-lifecycle-closure
  git merge --ff-only "$BASE" || { echo "Existing Goal04 branch is not fast-forwardable; resolve intentionally" >&2; exit 1; }
else
  git switch -c codex/goal-04-production-lifecycle-closure
fi
rm -rf .codex/goal-04-task-package
mkdir -p .codex/goal-04-task-package .codex/goal-04/evidence
cp -a "$SRC"/. .codex/goal-04-task-package/
find .codex/goal-04-task-package -type d -name __pycache__ -prune -exec rm -rf {} +
find .codex/goal-04-task-package -type f -name '*.pyc' -delete
rm -f .codex/goal-04-task-package/PACKAGE_MANIFEST.json .codex/goal-04-task-package/SHA256SUMS
cp .codex/goal-04-task-package/templates/task-state.json .codex/goal-04/task-state.json
cp .codex/goal-04-task-package/templates/execution-log.md .codex/goal-04/execution-log.md
cp .codex/goal-04-task-package/templates/decisions.md .codex/goal-04/decisions.md
cp .codex/goal-04-task-package/templates/blockers.md .codex/goal-04/blockers.md
cp .codex/goal-04-task-package/templates/handoff.json .codex/goal-04/handoff.json
python3 .codex/goal-04-task-package/scripts/capture_prior_goal_state.py .
python3 .codex/goal-04-task-package/scripts/verify_prior_goal_states_unchanged.py .
git add .codex/goal-04 .codex/goal-04-task-package
git commit -m "chore(goal04): activate production lifecycle closure package"
echo "Goal04 installed. Next: python3 .codex/goal-04-task-package/scripts/taskctl.py next"
