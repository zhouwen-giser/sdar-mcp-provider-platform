#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
python3 "$ROOT/scripts/validate_task_graph.py" "$ROOT/TASK_GRAPH.json"
python3 -m json.tool "$ROOT/references/GITHUB_BASELINE.json" >/dev/null
python3 -m json.tool "$ROOT/templates/task-state.json" >/dev/null
python3 -m json.tool "$ROOT/schemas/task-state.schema.json" >/dev/null
for f in "$ROOT"/scripts/*.py; do
  python3 - "$f" <<'PY'
import sys
p=sys.argv[1]
compile(open(p,encoding='utf-8').read(),p,'exec')
PY
done
for f in "$ROOT"/scripts/*.sh; do bash -n "$f"; done
python3 "$ROOT/scripts/verify_package_integrity.py" "$ROOT"
echo "Goal 03 package validation PASSED"
