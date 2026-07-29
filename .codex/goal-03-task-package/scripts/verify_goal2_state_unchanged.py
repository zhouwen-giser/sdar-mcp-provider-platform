#!/usr/bin/env python3
import hashlib,sys
from pathlib import Path
repo=Path(sys.argv[1] if len(sys.argv)>1 else '.')
state=repo/'.codex/task-state.json'
marker=repo/'.codex/goal-03/goal2-task-state.sha256'
if not state.exists(): raise SystemExit('Missing original .codex/task-state.json')
h=hashlib.sha256(state.read_bytes()).hexdigest()
if not marker.exists(): marker.write_text(h+'\n'); print('Captured Goal2 task-state hash',h)
elif marker.read_text().strip()!=h: raise SystemExit(f'Goal2 task state changed: expected {marker.read_text().strip()} actual {h}')
else: print('Goal2 task state unchanged',h)
