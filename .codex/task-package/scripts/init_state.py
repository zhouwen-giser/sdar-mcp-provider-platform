#!/usr/bin/env python3
import argparse,json,shutil,datetime
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('--goal',required=True); p.add_argument('--repo',required=True); a=p.parse_args()
r=Path(a.repo).resolve(); pkg=r/'.codex/task-package'; graph=json.loads((pkg/a.goal/'TASK_GRAPH.json').read_text()); tpl=json.loads((pkg/'templates/task-state.initial.json').read_text())
tpl['activeGoal']=a.goal; tpl['updatedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); tpl['tasks']={}
for t in graph['tasks']: tpl['tasks'][t['id']]={'status':'READY' if not t['dependencies'] else 'PLANNED','startedAt':None,'completedAt':None,'evidence':[],'reason':None}
(r/'.codex').mkdir(exist_ok=True); (r/'.codex/handoff').mkdir(exist_ok=True); (r/'.codex/reports').mkdir(exist_ok=True)
(r/'.codex/task-state.json').write_text(json.dumps(tpl,ensure_ascii=False,indent=2)+'\n')
for name,content in [('execution-log.md','# Execution Log\n'),('decisions.md','# Decisions\n'),('blockers.md','# Blockers\n')]:
    f=r/'.codex'/name
    if not f.exists(): f.write_text(content)
(r/'.codex/active-goal.json').write_text(json.dumps({'goalId':a.goal,'activatedAt':tpl['updatedAt']},indent=2)+'\n')
print(f'Initialized {a.goal} with {len(graph["tasks"])} tasks at {r}')
