#!/usr/bin/env python3
import json,sys
from pathlib import Path
errs=[]
for gf in Path('.').glob('goal-*/TASK_GRAPH.json'):
 g=json.loads(gf.read_text()); ids=[t['id'] for t in g['tasks']]; S=set(ids)
 if len(ids)!=g['taskCount'] or len(S)!=len(ids): errs.append(f'{gf}: count/duplicate')
 for t in g['tasks']:
  for d in t['dependencies']:
   if d not in S: errs.append(f'{gf}: {t["id"]} unknown dep {d}')
 # cycle
 visiting=set(); done=set(); m={t['id']:t['dependencies'] for t in g['tasks']}
 def dfs(x):
  if x in visiting: errs.append(f'{gf}: cycle at {x}'); return
  if x in done:return
  visiting.add(x)
  for d in m[x]: dfs(d)
  visiting.remove(x); done.add(x)
 for x in ids: dfs(x)
 for x in ids:
  if not (gf.parent/'tasks'/f'{x}.md').exists(): errs.append(f'{gf}: missing card {x}')
if errs:
 print('\n'.join(errs)); sys.exit(1)
print('Task graphs valid')
