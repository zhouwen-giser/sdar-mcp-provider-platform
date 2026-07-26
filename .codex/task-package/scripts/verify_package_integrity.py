#!/usr/bin/env python3
import hashlib,json,sys
from pathlib import Path
root=Path(__file__).resolve().parent.parent
manifest=json.loads((root/'PACKAGE_MANIFEST.json').read_text())
errs=[]
listed={x['path']:x for x in manifest.get('files',[])}
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name not in ('PACKAGE_MANIFEST.json','SHA256SUMS.txt')}
if actual!=set(listed):
    for x in sorted(actual-set(listed)): errs.append('unlisted file '+x)
    for x in sorted(set(listed)-actual): errs.append('missing file '+x)
for rel,x in listed.items():
    p=root/rel
    if p.exists():
        h=hashlib.sha256(p.read_bytes()).hexdigest()
        if h!=x['sha256']: errs.append('manifest hash mismatch '+rel)
        if p.stat().st_size!=x['size']: errs.append('manifest size mismatch '+rel)
for line in (root/'SHA256SUMS.txt').read_text().splitlines():
    if not line.strip(): continue
    h,rel=line.split('  ',1); p=root/rel
    if not p.exists(): errs.append('SHA256SUMS missing '+rel)
    elif hashlib.sha256(p.read_bytes()).hexdigest()!=h: errs.append('SHA256SUMS mismatch '+rel)
if errs:
    print('\n'.join(errs)); sys.exit(1)
print(f'Package integrity valid: {len(actual)} content files')
