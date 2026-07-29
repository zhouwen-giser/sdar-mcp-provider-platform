#!/usr/bin/env python3
import argparse, json, sys
from pathlib import Path
from datetime import datetime, timezone

ROOT=Path.cwd()
STATE=ROOT/'.codex/goal-04/task-state.json'
GRAPH=ROOT/'.codex/goal-04-task-package/TASK_GRAPH.json'

def load(p): return json.loads(p.read_text(encoding='utf-8'))
def save(p,v):
    v['updatedAt']=datetime.now(timezone.utc).isoformat()
    p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def deps(): return {t['id']:t.get('dependencies',[]) for t in load(GRAPH)['tasks']}
def refresh(s):
    d=deps()
    for tid,x in s['tasks'].items():
        if x['status']=='PLANNED' and all(s['tasks'][z]['status']=='PASSED' for z in d[tid]): x['status']='READY'
def main():
    ap=argparse.ArgumentParser(); sub=ap.add_subparsers(dest='cmd',required=True)
    sub.add_parser('status'); sub.add_parser('next')
    for c in ['start','pass','block']:
        p=sub.add_parser(c); p.add_argument('task_id')
        if c=='pass': p.add_argument('--evidence',required=True)
        if c=='block': p.add_argument('--reason',required=True)
    a=ap.parse_args()
    if not STATE.exists(): sys.exit(f'Cannot find {STATE}; run install_goal.sh first')
    s=load(STATE); refresh(s)
    if a.cmd=='status':
        summary={}
        for x in s['tasks'].values(): summary[x['status']]=summary.get(x['status'],0)+1
        print(json.dumps({'activeGoal':s['activeGoal'],'summary':summary,'inProgress':[k for k,v in s['tasks'].items() if v['status']=='IN_PROGRESS']},ensure_ascii=False,indent=2)); return
    if a.cmd=='next':
        ready=[k for k,v in s['tasks'].items() if v['status']=='READY']
        print(ready[0] if ready else 'NO_READY_TASK'); return
    tid=a.task_id
    if tid not in s['tasks']: sys.exit('Unknown task')
    x=s['tasks'][tid]; now=datetime.now(timezone.utc).isoformat()
    if a.cmd=='start':
        if x['status']!='READY': sys.exit(f'{tid} is {x["status"]}, expected READY')
        if any(v['status']=='IN_PROGRESS' for k,v in s['tasks'].items() if k!=tid): sys.exit('Another task is IN_PROGRESS')
        x['status']='IN_PROGRESS'; x['startedAt']=now
    elif a.cmd=='pass':
        if x['status']!='IN_PROGRESS': sys.exit(f'{tid} is {x["status"]}, expected IN_PROGRESS')
        x['status']='PASSED'; x['completedAt']=now; x['evidence'].append(a.evidence); x['reason']=None
    else:
        if x['status'] not in ('READY','IN_PROGRESS'): sys.exit(f'{tid} cannot be blocked from {x["status"]}')
        x['status']='BLOCKED'; x['reason']=a.reason
    refresh(s); save(STATE,s)
if __name__=='__main__': main()
