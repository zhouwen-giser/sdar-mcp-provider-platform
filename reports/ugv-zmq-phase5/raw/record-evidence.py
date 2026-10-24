from pathlib import Path
import datetime, gzip, hashlib, json, shutil, subprocess

smpp=Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform')
sdar=Path('/home/sz/code/skill-driven-agent-runtime-zmq-phase5')
raw=Path('/mnt/data/ugv-zmq-phase5-20261024')
run_id='sdar-verify-d392206e-dc0d-4ad9-ad43-f58fb94f85c2'
gate=sdar/'reports/runtime-semantic-closure'/run_id
if not (gate/'run.json').exists(): raise SystemExit('SDAR_FULL_GATE_NOT_FINAL')
gate_run=json.loads((gate/'run.json').read_text())
if gate_run['exitCode'] != 0: raise SystemExit('SDAR_FULL_GATE_NOT_PASSED')
report=smpp/'reports/ugv-zmq-phase5'
(report/'raw/logs').mkdir(parents=True,exist_ok=True)
sha=lambda b:hashlib.sha256(b).hexdigest()
records=[]
def command(name, cwd, argv, logfile, code=0, expected=0, environment=None):
    content=(raw/logfile).read_bytes()
    output=report/'raw/logs'/(name+'.log.gz')
    packed=gzip.compress(content,mtime=0)
    output.write_bytes(packed)
    records.append({'name':name,'cwd':str(cwd),'argv':argv,'environment':environment or {},'exitCode':code,'expectedExitCode':expected,'passed':code==expected,'log':str(output.relative_to(smpp)),'encoding':'gzip','sha256':sha(packed),'uncompressedSha256':sha(content)})
node=['node']
command('root-types',smpp,node+['node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json'],'root-types-native-module.log')
command('root-build',smpp,node+['node_modules/typescript/bin/tsc','-p','tsconfig.build.json'],'root-build-native-module.log')
changed=subprocess.check_output(['git','diff','--name-only','156c3cc6','HEAD'],cwd=smpp).decode().splitlines()
format_files=[p for p in changed if Path(p).suffix in {'.ts','.tsx','.mjs','.json','.md','.yaml','.yml'}]
lint_files=[p for p in changed if Path(p).suffix in {'.ts','.tsx','.mjs'}]
command('root-format',smpp,node+['node_modules/prettier/bin/prettier.cjs','--check',*format_files],'root-format-frozen.log')
command('root-lint',smpp,node+['node_modules/eslint/bin/eslint.js',*lint_files],'root-lint-final.log')
command('regression',smpp,node+['node_modules/vitest/vitest.mjs','run','tests/ugv-zmq/','tests/ugv-zmq-observer/','tests/ugv-zmq-control/','tests/unit/vehicle-grpc-stream-lifecycle.test.ts','tests/contract/task-business-operation-profile.test.ts','tests/integration/manifest-drift.test.ts','tests/ugv-zmq-provider/contract.test.ts'],'regression-final.log')
config={'SMPP_ZMQ_TEST_CONFIG_FILE':str(raw/'postgres-test.json')}
command('native-postgres-regression',smpp,node+['node_modules/vitest/vitest.mjs','run','tests/ugv-zmq-control-postgres/'],'control-postgres-regression.log',environment=config)
command('formal-frozen',smpp,node+['node_modules/vitest/vitest.mjs','run','tests/ugv-zmq-provider/'],'formal-frozen.log',environment={**config,'SMPP_ZMQ_SDAR_ROOT':str(sdar),'SMPP_ZMQ_FORMAL_RAW_FILE':str(raw/'formal-raw-frozen.ndjson'),'SMPP_ZMQ_FORMAL_EVIDENCE_FILE':str(raw/'formal-evidence-frozen.json')})
console=smpp/'apps/ugv-control-console'
command('console-tests',console,node+['../../node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts'],'console-test-release.log',environment={**config,'SMPP_INSPECTION_TEST_CONFIG_FILE':str(raw/'console-test.json')})
command('console-zmq-tests',console,node+['../../node_modules/vitest/vitest.mjs','run','--config','vitest.config.ts','test/zmq.test.ts'],'console-zmq-final.log')
command('console-types',console,node+['../../node_modules/typescript/bin/tsc','--noEmit','-p','tsconfig.json'],'console-types-frozen.log')
command('console-web-build',console,node+['node_modules/vite/bin/vite.js','build'],'console-build-release.log')
command('console-server-build',console,node+['../../node_modules/typescript/bin/tsc','-p','tsconfig.server.json'],'console-server-build-release.log')
command('legacy-browser',console,node+['node_modules/@playwright/test/cli.js','test'],'console-browser-legacy.log',environment={'SMPP_INSPECTION_TEST_CONFIG_FILE':str(raw/'console-test.json')})
command('native-browser',console,node+['node_modules/@playwright/test/cli.js','test','--config','playwright.zmq.config.ts'],'console-browser-zmq-final.log',environment={**config,'SMPP_ZMQ_BROWSER_RAW_FILE':str(raw/'browser-raw-final.ndjson'),'SMPP_ZMQ_BROWSER_EVIDENCE_FILE':str(raw/'browser-evidence-final.json'),'SMPP_ZMQ_BROWSER_REPORT_FILE':str(raw/'browser-report-final.json'),'UGV_ZMQ_BROWSER_SCREENSHOT':str(raw/'browser-desktop-final.png')})
command('package-tests',smpp,['python3','-m','unittest','discover','-s','tests/ugv-zmq-provider','-p','*_test.py'],'package-tests-final.log')
command('locked-contracts',smpp,node+['--import','tsx','scripts/ugv-zmq/check-contracts.ts'],'contracts-release.log')
command('protocol-full',smpp,['bash','-c','node scripts/protocol/check-frozen-contract.mjs && node scripts/protocol/fetch-pinned-mcp-schema.mjs --check && node scripts/protocol/validate-protocol-schemas.mjs && node scripts/protocol/verify-protocol-lock.mjs'],'protocol-full.log')
command('source-g0',smpp,node+['dist/scripts/ugv-zmq/preflight.js','--report',str(raw/'g0-release.json')],'g0-release.log',2,2)
image='smpp/ugv-zmq-candidate:20261025-phase5'
command('docker-build',smpp,['docker','build','--target','ugv-zmq-candidate','--build-arg','VCS_REF=655a0b725845426d2ec01216b48e3361455d9842','--tag',image,'.'],'docker-build-pinned.log')
command('docker-native-module',smpp,['docker','run','--rm','--network','none','--read-only','--entrypoint','node',image,'--input-type=module','-e','import {createRequire} from "node:module";const require=createRequire(import.meta.url);const z=require("zeromq");const s=new z.Pair();s.close();await import("./dist/apps/ugv-zmq-provider-adapter/src/bootstrap.js");console.log(JSON.stringify({node:process.version,zeromq:require("zeromq/package.json").version,libzmq:z.version,providerModule:"loaded",socket:"constructed_closed",network:"none"}));'],'docker-native-qualified.json')
command('docker-g0',smpp,['docker','run','--rm','--network','none','--read-only','--entrypoint','node',image,'dist/scripts/ugv-zmq/preflight.js'],'docker-g0-qualified.json',2,2)
command('docker-default-start-rejection',smpp,['docker','run','--rm','--network','none','--read-only','--entrypoint','node',image,'dist/apps/ugv-zmq-provider-adapter/src/main.js'],'docker-no-config-final.log',1,1)
invocation=json.loads((raw/'sdar-affinity-invocation.json').read_text())
command('sdar-full',sdar,invocation['argv'],'sdar-full-gate-affinity.log',code=invocation['exitCode'],environment=invocation['environment'])
records[-1].update(startedAt=invocation['startedAt'],finishedAt=invocation['finishedAt'])
command('sdar-isolation',sdar,node+['scripts/test-verification-isolation.mjs'],'sdar-isolation-final.log')
command('sdar-runner',sdar,node+['scripts/test-verification-runner.mjs'],'sdar-runner-final.log')
for kind in ['formal','browser']:
    suffix='frozen' if kind=='formal' else 'final'
    command(kind+'-source-proof',smpp,node+['--import','tsx','scripts/ugv-zmq/verify-control-evidence.ts',str(raw/(kind+'-raw-'+suffix+'.ndjson')),str(raw/(kind+'-evidence-'+suffix+'.json'))],kind+'-proof-'+suffix+'.json')
artifacts=[]
def artifact(source,name=None,compress=False):
    data=source.read_bytes()
    destination=report/'raw'/(name or source.name)
    if compress:
        data=gzip.compress(data,mtime=0)
        destination=destination.with_name(destination.name+'.gz')
    destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_bytes(data)
    artifacts.append({'path':str(destination.relative_to(smpp)),'bytes':len(data),'sha256':sha(data),'encoding':'gzip' if compress else 'identity'})
for name in ['formal-raw-frozen.ndjson','formal-evidence-frozen.json','browser-raw-final.ndjson','browser-evidence-final.json','browser-report-final.json']:
    artifact(raw/name,compress=True)
for name in ['formal-proof-frozen.json','browser-proof-final.json','g0-release.json','docker-source-proof-qualified.json','docker-native-qualified.json','site-containers.json','cpu-profile.json','sdar-affinity-invocation.json','sdar-tail-valid-diagnostic.json','fixture-cleanup.json','source-integrity-trial.tar.gz.receipt.json','sdar-infra-default-bridge-probe.json']:
    artifact(raw/name)
artifact(raw/'browser-desktop-final.png')
artifact(raw/'record-evidence.py')
for name in ['run.json','inputs.json','network.json']:
    artifact(gate/name,'sdar-'+name,compress=name=='inputs.json')
summary=gate/'snapshot-reports/verification/summary.json'
summary_value=json.loads(summary.read_text())
for step in summary_value['steps']:
    source=gate/'snapshot-reports'/Path(step['logPath']).relative_to('reports')
    if sha(source.read_bytes()) != step['outputSha256']:
        raise SystemExit('SDAR_STAGE_LOG_HASH_MISMATCH:'+step['name'])
    artifact(source,'sdar-steps/'+step['name']+'.log',compress=True)
performance=[json.loads(line) for line in (raw/'sdar-full-gate-affinity.log').read_text().splitlines() if line.startswith('{"event":"phase13.performance.raw_metrics"')][-1]
keys=['baselineP95RawMs','evidenceEnabledP95RawMs','regressionRawPercent','baselineMedianDriftRawPercent','appendP95RawMs']
performance={key:performance[key] for key in keys}
(raw/'sdar-performance.json').write_text(json.dumps({'observed':performance,'limits':{'baselineMedianDriftRawPercent':15,'regressionRawPercent':10,'appendP95RawMs':20},'thresholdsChanged':False},indent=2)+'\n')
artifact(raw/'sdar-performance.json')
artifact(summary,'sdar-full-summary.json')
artifact(gate/'snapshot-reports/verification/summary.md','sdar-full-summary.md')
failed=sdar/'reports/runtime-semantic-closure/sdar-verify-4d7468a3-1f60-4474-9cc0-b94e4f51aa62/run.json'
artifact(failed,'sdar-failed-network-run.json')
artifact(sdar/'reports/runtime-semantic-closure/sdar-verify-c77b2c42-d767-4b31-9760-57a68f3eb488/run.json','sdar-failed-toolchain-run.json')
artifact(sdar/'reports/runtime-semantic-closure/sdar-verify-56ba1b94-8dae-4d6c-99b1-901989b8a882/run.json','sdar-failed-baseline-drift-run.json')
for name in ['sdar-full-gate-boundary.log','sdar-full-gate-network.log','sdar-full-gate-toolchain.log','sdar-full-gate-verified.log','sdar-infra-helper-proof.log','docker-g0-final.log','root-lint-native-module.log','catalog-final.log']:
    artifact(raw/name,'attempts/'+name,compress=True)
source_files=[]
for path in changed:
    if not path.startswith('reports/') and (smpp/path).is_file():
        data=(smpp/path).read_bytes()
        source_files.append({'path':path,'bytes':len(data),'sha256':sha(data)})
(report/'source-inputs.json').write_text(json.dumps({'sourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=smpp).decode().strip(),'files':source_files},indent=2)+'\n')
verification={'schemaVersion':'ugv.zmq-phase5-verification/1','classification':'ISOLATED_FORMAL_RUNTIME_SIMULATED_ONLY','generatedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'smppSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=smpp).decode().strip(),'sdarSourceCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=sdar).decode().strip(),'phase5Complete':False,'fieldQualified':False,'sdarGovernancePublished':False,'realDeviceCommands':0,'siteContainersUpdated':False,'g0Missing':12,'configFilesShipped':False,'commands':records,'artifacts':artifacts,'sdarFullGate':{'runId':run_id,'exitCode':gate_run['exitCode'],'inputSha256':gate_run['inputSha256'],'baselineSha256':gate_run['baselineSha256'],'inputUnchanged':gate_run['inputUnchanged'],'baselineUnchanged':gate_run['baselineUnchanged'],'networkMode':gate_run['networkMode'],'testProcessCpuAffinity':invocation['cpuProfile'],'cleanupExitCode':gate_run['cleanupExitCode']}}
(report/'verification.json').write_text(json.dumps(verification,ensure_ascii=False,indent=2)+'\n')
sdar_report=sdar/'reports/ugv-zmq-phase5'
(sdar_report/'raw').mkdir(parents=True,exist_ok=True)
for name in ['sdar-run.json','sdar-inputs.json.gz','sdar-network.json','sdar-full-summary.json','sdar-full-summary.md','sdar-failed-network-run.json','sdar-failed-baseline-drift-run.json','sdar-failed-toolchain-run.json','formal-proof-frozen.json','docker-source-proof-qualified.json']:
    shutil.copyfile(report/'raw'/name,sdar_report/'raw'/name)
shutil.copytree(report/'raw/sdar-steps',sdar_report/'raw/sdar-steps',dirs_exist_ok=True)
for name in ['sdar-full.log.gz','sdar-isolation.log.gz','sdar-runner.log.gz','formal-frozen.log.gz']:
    shutil.copyfile(report/'raw/logs'/name,sdar_report/'raw'/name)
(sdar_report/'verification.json').write_text(json.dumps({'schemaVersion':'sdar.zmq-phase5-verification/1','sourceCommit':verification['sdarSourceCommit'],'smppSourceCommit':verification['smppSourceCommit'],'candidateOnly':True,'governancePublication':False,'fieldQualified':False,'fullGate':verification['sdarFullGate'],'files':[{'path':str(p.relative_to(sdar)),'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())} for p in sorted((sdar_report/'raw').rglob('*')) if p.is_file()]},indent=2)+'\n')
print(json.dumps({'smppReport':str(report),'sdarReport':str(sdar_report),'commands':len(records),'artifacts':len(artifacts),'sdarFullExit':gate_run['exitCode']}))
