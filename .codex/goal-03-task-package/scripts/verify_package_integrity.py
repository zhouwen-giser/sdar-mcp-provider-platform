#!/usr/bin/env python3
import hashlib,json,sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.')
m=json.loads((root/'PACKAGE_MANIFEST.json').read_text())
expected={x['path'] for x in m['files']}
actual={p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p.name not in {'PACKAGE_MANIFEST.json','SHA256SUMS'}}
missing=expected-actual
extra=actual-expected
if missing: raise SystemExit('Missing files: '+','.join(sorted(missing)))
if extra: raise SystemExit('Unexpected files: '+','.join(sorted(extra)))
for x in m['files']:
 p=root/x['path']; h=hashlib.sha256(p.read_bytes()).hexdigest()
 if h!=x['sha256']: raise SystemExit('Checksum mismatch: '+x['path'])
print('Package integrity OK',len(m['files']))
