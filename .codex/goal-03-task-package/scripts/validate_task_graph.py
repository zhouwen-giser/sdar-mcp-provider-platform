#!/usr/bin/env python3
import json,sys
from pathlib import Path
p=Path(sys.argv[1] if len(sys.argv)>1 else 'TASK_GRAPH.json')
g=json.loads(p.read_text())
ts=g['tasks']; ids=[t['id'] for t in ts]
assert len(ids)==len(set(ids))
known=set(ids)
for t in ts:
    for d in t.get('dependencies',[]): assert d in known, (t['id'],d)
vis=set(); stack=set(); mp={t['id']:t.get('dependencies',[]) for t in ts}
def dfs(x):
    if x in stack: raise AssertionError('cycle:'+x)
    if x in vis:return
    stack.add(x)
    for d in mp[x]: dfs(d)
    stack.remove(x);vis.add(x)
for x in ids:dfs(x)
print(f'OK tasks={len(ids)}')
