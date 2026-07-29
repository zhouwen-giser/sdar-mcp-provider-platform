#!/usr/bin/env python3
import hashlib,json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
m=json.loads((root/'PACKAGE_MANIFEST.json').read_text(encoding='utf-8'))
errors=[]
for item in m['files']:
    p=root/item['path']
    if not p.exists(): errors.append('missing '+item['path']); continue
    b=p.read_bytes(); h=hashlib.sha256(b).hexdigest()
    if h!=item['sha256']: errors.append('hash '+item['path'])
    if len(b)!=item['size']: errors.append('size '+item['path'])
if errors: raise SystemExit('\n'.join(errors))
print('PACKAGE_INTEGRITY_OK')
