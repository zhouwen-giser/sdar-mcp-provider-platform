#!/usr/bin/env python3
import json, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
rootpkg=json.loads((root/'package.json').read_text(encoding='utf-8'))
if rootpkg.get('name')!='sdar-mcp-provider-platform': raise SystemExit('root package name not platform')
if rootpkg.get('version')!='0.1.0': raise SystemExit('root platform version must be 0.1.0')
runtime=json.loads((root/'apps/runtime/package.json').read_text(encoding='utf-8'))
if runtime.get('name')!='@sdar/runtime' or runtime.get('version')!='2.0.0-rc.1': raise SystemExit('runtime component version changed')
manifest=root/'reports/platform-v0.1/RELEASE_MANIFEST.json'
if not manifest.exists(): raise SystemExit('missing release manifest')
m=json.loads(manifest.read_text(encoding='utf-8'))
raw=manifest.read_text(encoding='utf-8')
if 'commit-containing-this' in raw: raise SystemExit('release commit placeholder remains')
sha=m.get('candidateSourceCommit')
if not isinstance(sha,str) or len(sha)!=40 or any(c not in '0123456789abcdef' for c in sha.lower()): raise SystemExit('candidateSourceCommit invalid')
for p in [root/'reports/platform-v0.1/TEST_EVIDENCE.json',root/'.codex/goal-04/handoff.json']:
    if not p.exists(): raise SystemExit(f'missing {p}')
    if 'commit-containing-this' in p.read_text(encoding='utf-8'): raise SystemExit(f'placeholder remains in {p}')
print('RELEASE_METADATA_OK')
