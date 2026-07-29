#!/usr/bin/env python3
import re, sys
from pathlib import Path
root=Path(sys.argv[1] if len(sys.argv)>1 else '.').resolve()
scheduler_only='--scheduler-only' in sys.argv
files=list((root/'apps/pms-worker/src').glob('*.ts'))
text='\n'.join(p.read_text(encoding='utf-8') for p in files)
if 'runtime_deployment.reconcile' not in text: raise SystemExit('missing reconcile job type')
if 'provider_package.sync' not in text and not scheduler_only: raise SystemExit('missing package sync job type')
if 'createRuntimeDatabasePreparationJobHandler' in text and not scheduler_only:
    # Definition may remain only if not registered. Reject registration-style usage in bootstrap/composition.
    for name in ['bootstrap.ts','composition.ts','runtime-composition.ts']:
        p=root/'apps/pms-worker/src'/name
        if p.exists() and 'createRuntimeDatabasePreparationJobHandler' in p.read_text(encoding='utf-8'):
            raise SystemExit('database preparation handler is registered as external job')
if scheduler_only:
    if 'advisory' not in text.lower(): raise SystemExit('scheduler must document/use advisory locking')
    print('WORKER_SCHEDULER_CONTRACT_OK'); raise SystemExit(0)
# Count handler construction references in production composition/boot files.
prod='\n'.join((root/'apps/pms-worker/src'/n).read_text(encoding='utf-8') for n in ['bootstrap.ts','composition.ts','runtime-composition.ts'] if (root/'apps/pms-worker/src'/n).exists())
for req in ['createRuntimeDeploymentReconcileJobHandler','PeriodicReconcileScheduler']:
    if req not in prod: raise SystemExit(f'production worker missing {req}')
print('WORKER_RECONCILE_CONTRACT_OK')
