#!/usr/bin/env python3
import argparse,json,subprocess,sys
from pathlib import Path
p=argparse.ArgumentParser(); p.add_argument('--repo',default='.'); a=p.parse_args(); r=Path(a.repo).resolve()
h=r/'.codex/handoff/goal1-handoff.json'; s=r/'.codex/task-state.json'
errs=[]
if not h.exists(): errs.append('missing goal1-handoff.json')
if not s.exists(): errs.append('missing task-state.json')
if not errs:
 d=json.loads(h.read_text()); st=json.loads(s.read_text())
 if d.get('goalId')!='goal-01' or d.get('status')!='PASSED': errs.append('handoff goal/status invalid')
 if d.get('sourceBaselineSha256')!='000a46f7452eadac986de3f142dde6358a590c5c372bee2e09793fe9396ad6e3': errs.append('source SHA mismatch')
 summary=d.get('taskSummary',{})
 if summary.get('total')!=50 or summary.get('passed')!=50: errs.append('handoff task summary not 50/50')
 c={}
 for x in st.get('tasks',{}).values(): c[x['status']]=c.get(x['status'],0)+1
 if c.get('PASSED')!=50 or sum(c.values())!=50: errs.append(f'task state not 50 PASSED: {c}')
 for k in ('migrationIsolation','configE2E','runtimeRegression'):
  if not d.get('gates',{}).get(k): errs.append(f'missing gate {k}')
try:
 dirty=subprocess.check_output(['git','-C',str(r),'status','--porcelain'],text=True).strip()
 if dirty: errs.append('git worktree not clean')
except Exception as e: errs.append(f'git check failed: {e}')
if errs:
 print('Goal 1 handoff invalid:'); [print('- '+e) for e in errs]; sys.exit(1)
print('Goal 1 handoff valid')
