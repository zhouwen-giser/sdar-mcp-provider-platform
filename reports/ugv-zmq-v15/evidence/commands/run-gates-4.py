import os,sys,json,subprocess,hashlib,time,datetime
from pathlib import Path
root=Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform')
evidence=root/'reports/ugv-zmq-v15/evidence/attempt-4';evidence.mkdir(parents=True,exist_ok=True)
env=os.environ.copy();env['SMPP_ZMQ_TEST_CONFIG_FILE']='/home/sz/.smpp-debug/zmq-v15-20261112/test.json';env['SMPP_INSPECTION_TEST_CONFIG_FILE']=env['SMPP_ZMQ_TEST_CONFIG_FILE']
groups={
'core':[
 ['typecheck',['pnpm','typecheck']],['lint',['pnpm','lint']],['build',['pnpm','build']],['frozen-mcp',['pnpm','protocol:check']],
 ['native-contracts',['pnpm','zmq:contract:check']],
 *[[f'catalog-{name}',['node','--import','tsx',f'scripts/ugv-zmq/{name}.ts','--check']] for name in ['site-catalog','site-control-catalog','site-control-v13-catalog','site-control-v14-catalog','v15-catalog']],
 ['manifest-memory',['node','--expose-gc','--import','tsx','scripts/ugv-zmq/check-manifest-memory.ts']]],
'unit':[['unit',['pnpm','exec','vitest','run','tests/ugv-zmq/','tests/ugv-zmq-observer/','tests/ugv-zmq-control/','tests/ugv-zmq-frames/','tests/integration/manifest-drift.test.ts']]],
'postgres':[['postgres',['pnpm','exec','vitest','run','tests/ugv-zmq-control-postgres/','tests/ugv-zmq-observer-postgres/','tests/ugv-zmq-provider/']],['v15-control',['pnpm','exec','vitest','run','tests/ugv-zmq-provider/site-control.postgres.test.ts']]],
'console':[['console-typecheck',['pnpm','--filter','@sdar/ugv-control-console','typecheck']],['console-build',['pnpm','--filter','@sdar/ugv-control-console','build']],['console-tests',['pnpm','--filter','@sdar/ugv-control-console','test']],['browser',['pnpm','--filter','@sdar/ugv-control-console','exec','playwright','test','--config','playwright.v15.config.ts']]]}
name=sys.argv[1]
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
for label,cmd in groups[name]:
 current=env.copy()
 if label=='v15-control':current['SMPP_ZMQ_TEST_CATALOG_PROFILE']='zmq_v1_5_0_site_control_15'
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.monotonic()
 log=evidence/(label+'.log')
 with log.open('wb') as out:r=subprocess.run(cmd,cwd=root,env=current,stdout=out,stderr=subprocess.STDOUT)
 data={'sourceCommit':head,'command':cmd,'environmentFiles':['/home/sz/.smpp-debug/zmq-v15-20261112/test.json'] if name in ['postgres','console'] else [],'catalogProfile':current.get('SMPP_ZMQ_TEST_CATALOG_PROFILE'),'startedAt':start,'elapsedSeconds':round(time.monotonic()-clock,3),'exitCode':r.returncode,'log':str(log.relative_to(root)),'sha256':hashlib.sha256(log.read_bytes()).hexdigest()}
 (evidence/(label+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'gate':label,'exitCode':r.returncode,'seconds':data['elapsedSeconds']}),flush=True)
 if r.returncode:sys.exit(r.returncode)
