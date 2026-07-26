#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash scripts/verify_source_baseline.sh
python3 scripts/validate_task_graph.py
python3 scripts/verify_package_integrity.py
python3 - <<'PY'
import json
from pathlib import Path
for p in Path('schemas').glob('*.json'): json.loads(p.read_text())
for p in [Path('PACKAGE_MANIFEST.json')]:
 if p.exists(): json.loads(p.read_text())
print('JSON files valid')
PY
find . -type f -name '*.sh' -exec bash -n {} \;
echo 'Package validation passed'
