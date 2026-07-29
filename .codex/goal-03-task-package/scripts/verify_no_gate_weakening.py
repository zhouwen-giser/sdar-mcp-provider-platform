#!/usr/bin/env python3
import json,sys
p=sys.argv[1] if len(sys.argv)>1 else 'package.json'
d=json.load(open(p,encoding='utf-8')); s=d.get('scripts',{})
required=['verify:v2','verify:frozen-protocol','test:frozen-74','test:runtime:closure','test:runtime:followup','test:interop:pr16','verify:business-events','verify']
missing=[x for x in required if x not in s]
if missing: raise SystemExit('Missing scripts: '+','.join(missing))
for k in required:
    v=s[k]
    if '|| true' in v or v.strip() in ('true',':','echo ok'): raise SystemExit(f'Gate weakened: {k}')
print('Gate names and fail-closed patterns present')
