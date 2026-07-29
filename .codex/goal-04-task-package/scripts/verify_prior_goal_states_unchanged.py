#!/usr/bin/env python3
import hashlib, json, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
base=root/'.codex/goal-04/prior-state-baseline.json'
if not base.exists(): raise SystemExit('missing prior-state-baseline.json; run install_goal.sh')
data=json.loads(base.read_text(encoding='utf-8'))['sha256']
errors=[]
for rel,expected in data.items():
    p=root/rel
    if not p.exists(): errors.append(f'missing {rel}'); continue
    actual=hashlib.sha256(p.read_bytes()).hexdigest()
    if actual!=expected: errors.append(f'changed {rel}: {actual} != {expected}')
if errors: raise SystemExit('\n'.join(errors))
print('PRIOR_GOAL_STATES_UNCHANGED')
