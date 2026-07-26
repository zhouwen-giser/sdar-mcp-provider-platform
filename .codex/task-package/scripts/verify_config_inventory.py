#!/usr/bin/env python3
import json,sys
from pathlib import Path
p=Path('docs/configuration/CONFIG_INVENTORY.json')
if not p.exists(): print('config inventory missing'); sys.exit(1)
d=json.loads(p.read_text()); req={'key','source','group','secret','applyMode'}; errs=[]
for i,x in enumerate(d.get('items',[])):
 if not req.issubset(x): errs.append(f'item {i} missing {req-set(x)}')
if not d.get('items'): errs.append('inventory empty')
if errs: print('\n'.join(errs)); sys.exit(1)
print(f'Config inventory valid: {len(d["items"])} items')
