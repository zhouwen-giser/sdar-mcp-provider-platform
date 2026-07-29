#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
python3 scripts/validate_task_graph.py
python3 - <<'PYCOMPILE'
from pathlib import Path
for p in Path('scripts').glob('*.py'):
    compile(p.read_text(encoding='utf-8'), str(p), 'exec')
print('PYTHON_SYNTAX_OK')
PYCOMPILE
for f in scripts/*.sh; do bash -n "$f"; done
python3 - <<'PY'
import json
from pathlib import Path
for p in Path('.').rglob('*.json'): json.loads(p.read_text(encoding='utf-8'))
print('JSON_OK')
PY
python3 scripts/verify_package_integrity.py
[[ "$(find tasks -maxdepth 1 -name 'G4-*.md' | wc -l)" -eq 9 ]]
echo "GOAL04_PACKAGE_VALID"
