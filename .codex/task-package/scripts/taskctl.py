#!/usr/bin/env python3
import argparse,json,datetime,subprocess
from pathlib import Path

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def root():
    p=Path.cwd()
    while p!=p.parent:
        if (p/'.codex/task-state.json').exists(): return p
        p=p.parent
    raise SystemExit('Cannot find .codex/task-state.json; run from initialized repository')
def load(r): return json.loads((r/'.codex/task-state.json').read_text())
def graph(r,state):
    g=state['activeGoal']
    return json.loads((r/f'.codex/task-package/{g}/TASK_GRAPH.json').read_text())
def save(r,s):
    s['updatedAt']=now(); (r/'.codex/task-state.json').write_text(json.dumps(s,ensure_ascii=False,indent=2)+'\n')
def refresh(s,g):
    deps={t['id']:t['dependencies'] for t in g['tasks']}
    for tid,d in deps.items():
        st=s['tasks'][tid]['status']
        if st=='PLANNED' and all(s['tasks'][x]['status']=='PASSED' for x in d): s['tasks'][tid]['status']='READY'
def log(r,msg):
    with (r/'.codex/execution-log.md').open('a') as f: f.write(f"\n- {now()} {msg}\n")
p=argparse.ArgumentParser(); sub=p.add_subparsers(dest='cmd',required=True)
sub.add_parser('status'); sub.add_parser('next')
a=sub.add_parser('start'); a.add_argument('task')
a=sub.add_parser('pass'); a.add_argument('task'); a.add_argument('--evidence',action='append',default=[])
a=sub.add_parser('block'); a.add_argument('task'); a.add_argument('--reason',required=True)
a=sub.add_parser('fail'); a.add_argument('task'); a.add_argument('--reason',required=True)
a=sub.add_parser('ready'); a.add_argument('task')
args=p.parse_args(); r=root(); s=load(r); g=graph(r,s); refresh(s,g)
if args.cmd=='status':
    from collections import Counter
    c=Counter(x['status'] for x in s['tasks'].values()); print(json.dumps({'activeGoal':s['activeGoal'],'summary':c,'inProgress':[k for k,v in s['tasks'].items() if v['status']=='IN_PROGRESS']},ensure_ascii=False,indent=2))
elif args.cmd=='next':
    xs=[t['id'] for t in g['tasks'] if s['tasks'][t['id']]['status']=='READY']; print(xs[0] if xs else 'NO_READY_TASK')
else:
    tid=args.task
    if tid not in s['tasks']: raise SystemExit(f'Unknown task {tid}')
    x=s['tasks'][tid]
    if args.cmd=='start':
        if any(v['status']=='IN_PROGRESS' for k,v in s['tasks'].items() if k!=tid): raise SystemExit('Another task is IN_PROGRESS')
        if x['status']!='READY': raise SystemExit(f'{tid} is {x["status"]}, not READY')
        x['status']='IN_PROGRESS'; x['startedAt']=now(); log(r,f'START {tid}')
    elif args.cmd=='pass':
        if x['status']!='IN_PROGRESS': raise SystemExit(f'{tid} is not IN_PROGRESS')
        x['status']='PASSED'; x['completedAt']=now(); x['evidence'].extend(args.evidence); log(r,f'PASS {tid} evidence={args.evidence}')
    elif args.cmd in ('block','fail'):
        if x['status'] not in ('IN_PROGRESS','READY'): raise SystemExit(f'{tid} cannot transition from {x["status"]}')
        x['status']='BLOCKED' if args.cmd=='block' else 'FAILED'; x['reason']=args.reason; log(r,f'{x["status"]} {tid}: {args.reason}')
    elif args.cmd=='ready':
        if x['status'] not in ('BLOCKED','FAILED'): raise SystemExit('ready only resets BLOCKED/FAILED')
        x['status']='READY'; x['reason']=None; log(r,f'READY {tid}')
    refresh(s,g); save(r,s)
