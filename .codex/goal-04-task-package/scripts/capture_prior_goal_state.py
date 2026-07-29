#!/usr/bin/env python3
import hashlib, json, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
paths=[
 '.codex/task-state.json',
 '.codex/handoff/goal2-handoff.json',
 '.codex/goal-03/task-state.json',
 '.codex/goal-03/handoff.json',
 '.codex/goal-03/test-evidence.json',
]
out={}
for rel in paths:
    p=root/rel
    if not p.exists(): raise SystemExit(f'missing prior goal file: {rel}')
    out[rel]=hashlib.sha256(p.read_bytes()).hexdigest()
dst=root/'.codex/goal-04/prior-state-baseline.json'
dst.parent.mkdir(parents=True,exist_ok=True)
dst.write_text(json.dumps({'schemaVersion':'1.0','sha256':out},indent=2)+'\n',encoding='utf-8')
print(dst)
