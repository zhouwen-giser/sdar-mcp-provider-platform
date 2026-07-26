#!/usr/bin/env python3
import json,hashlib,sys
from pathlib import Path
p=Path('migrations/migration-source-map.json')
if not p.exists(): print('source map not created yet'); sys.exit(1)
d=json.loads(p.read_text()); errs=[]
for x in d.get('migrations',[]):
 q=Path(x['newPath'])
 if not q.exists(): errs.append('missing '+str(q)); continue
 h=hashlib.sha256(q.read_bytes()).hexdigest()
 if h!=x['sha256']: errs.append('hash mismatch '+str(q))
if errs: print('\n'.join(errs)); sys.exit(1)
print(f'Migration source map valid: {len(d.get("migrations",[]))} files')
