#!/usr/bin/env python3
import json, sys
from pathlib import Path
p=Path(__file__).resolve().parents[1]/'TASK_GRAPH.json'
g=json.loads(p.read_text(encoding='utf-8'))
tasks=g['tasks']; ids=[t['id'] for t in tasks]
if len(ids)!=len(set(ids)): sys.exit('duplicate task id')
known=set(ids)
for t in tasks:
    for d in t.get('dependencies',[]):
        if d not in known: sys.exit(f'unknown dependency {d}')
state={}
def visit(x):
    if state.get(x)==1: sys.exit(f'cycle at {x}')
    if state.get(x)==2: return
    state[x]=1
    t=next(t for t in tasks if t['id']==x)
    for d in t.get('dependencies',[]): visit(d)
    state[x]=2
for x in ids: visit(x)
if len(ids)!=9: sys.exit(f'expected 9 tasks, got {len(ids)}')
print('TASK_GRAPH_OK')
