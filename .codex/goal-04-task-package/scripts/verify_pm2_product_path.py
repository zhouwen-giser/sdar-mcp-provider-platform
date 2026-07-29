#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
bridge_only='--bridge-only' in sys.argv
pkg=root/'packages/pm2-runtime-adapter/package.json'
if not pkg.exists(): raise SystemExit('missing PM2 adapter package')
data=json.loads(pkg.read_text(encoding='utf-8'))
if data.get('dependencies',{}).get('pm2')!='7.0.3': raise SystemExit('pm2 must be exact dependency 7.0.3')
bridge=root/'packages/pm2-runtime-adapter/src/pm2/javascript-api.ts'
if not bridge.exists(): raise SystemExit('missing production PM2 javascript bridge')
text=bridge.read_text(encoding='utf-8')
for bad in ['child_process','exec(','spawn(','shell:']:
    if bad in text: raise SystemExit(f'forbidden PM2 bridge token: {bad}')
if bridge_only:
    print('PM2_BRIDGE_OK'); raise SystemExit(0)
e2e=root/'tests/pm2-adapter-e2e/run-real-pm2-e2e.mjs'
if not e2e.exists(): raise SystemExit('missing real PM2 E2E')
e=e2e.read_text(encoding='utf-8')
for pattern, label in [
    (r"[\"']dlx[\"']\s*,\s*[\"']pm2[\"']", 'pnpm dlx pm2'),
    (r"pnpm\s+dlx\s+pm2", 'pnpm dlx pm2'),
    (r"ecosystem(?:\.config)?", 'ecosystem-file PM2 control'),
    (r"[\"']pm2[\"']\s*,\s*\[", 'direct PM2 CLI argument list'),
]:
    if re.search(pattern, e, re.IGNORECASE): raise SystemExit(f'real PM2 E2E bypass remains: {label}')
for required in ['createPm2JavascriptApi','Pm2ProcessManager','RuntimeLifecycleManager']:
    if required not in e: raise SystemExit(f'real PM2 E2E missing product class: {required}')
print('PM2_PRODUCT_PATH_OK')
