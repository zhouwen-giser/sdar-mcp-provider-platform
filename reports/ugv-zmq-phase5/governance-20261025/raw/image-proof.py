#!/usr/bin/env python3
import hashlib,json,subprocess
from pathlib import Path

root=Path('/mnt/data/ugv-zmq-phase5-governance-20261025')
smpp=Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform')
sdar=Path('/home/sz/code/skill-driven-agent-runtime-zmq-phase5')
specs=[
 ('provider','smpp/ugv-zmq-candidate:20261025-governance-0e4b25a',smpp,
  ['dist/apps/ugv-zmq-provider-adapter','dist/scripts/ugv-zmq','dist/packages/vehicle-zmq-contract','dist/packages/vehicle-zmq-control','dist/packages/vehicle-zmq-observer'],
  ['./dist/apps/ugv-zmq-provider-adapter/src/bootstrap.js','./dist/apps/ugv-zmq-provider-adapter/src/runtime.js','./dist/apps/ugv-zmq-provider-adapter/src/server.js','zeromq']),
 ('smpp-runtime','smpp/runtime:zmq-candidate-20261025-0e4b25a',smpp,
  ['dist/apps/runtime','dist/packages'],['./dist/apps/runtime/src/runtime.js']),
 ('console','smpp/ugv-control-console:zmq-candidate-20261025-8b8f44c',smpp/'apps/ugv-control-console',
  ['build','dist'],['./build/server/config.js','./build/server/app.js','./build/server/service.js']),
 ('sdar-runtime','sdar/runtime:zmq-candidate-20261025-93cada52',sdar,
  ['dist/packages','dist/apps/server','dist/apps/node-control-api','dist/apps/node-control-worker','dist/apps/node-control-acceptance','apps/console/dist'],
  ['./dist/packages/ugv-profile/src/zmq-workflow.js','./dist/packages/ugv-profile/src/zmq-skill.js','./dist/packages/domain/src/zmq-capability.js','./dist/packages/node-control-persistence-postgres/src/index.js','./dist/apps/node-control-api/src/runtime.js'])
]
result={'schemaVersion':'ugv.zmq-candidate-image-proof/1','classification':'OFFLINE_MODULE_LOADING_AND_COMPILED_FILE_PARITY_ONLY','network':'none','readOnly':True,'productionServicesUpdated':False,'images':[]}
for name,tag,host,paths,modules in specs:
 inspect=json.loads(subprocess.check_output(['docker','image','inspect',tag]))[0]
 base=['docker','run','--rm','--network','none','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--entrypoint','node',tag]
 script="""import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';import {createHash} from 'node:crypto';
const paths=PATHS,modules=MODULES,files=[];
function walk(path){for(const n of readdirSync(path)){const f=join(path,n),s=statSync(f);if(s.isDirectory())walk(f);else if(s.isFile()&&!f.endsWith('.map'))files.push({path:f,sha256:createHash('sha256').update(readFileSync(f)).digest('hex')});}}
for(const p of paths)walk(p);for(const m of modules)await import(m);
console.log(JSON.stringify({files:files.sort((a,b)=>a.path.localeCompare(b.path)),loaded:modules}));
""".replace('PATHS',json.dumps(paths)).replace('MODULES',json.dumps(modules))
 completed=subprocess.run(base+['--input-type=module','-e',script],capture_output=True,text=True)
 if completed.returncode: raise RuntimeError(name+':'+completed.stderr)
 manifest=json.loads(completed.stdout)
 for f in manifest['files']:
  local=host/f['path']
  if not local.is_file() or hashlib.sha256(local.read_bytes()).hexdigest()!=f['sha256']:
   raise RuntimeError('COMPILED_FILE_MISMATCH:'+name+':'+f['path'])
 item={'component':name,'tag':tag,'imageId':inspect['Id'],'sourceRevision':inspect['Config']['Labels'].get('org.opencontainers.image.revision'),'loadedModules':manifest['loaded'],'compiledFileCount':len(manifest['files']),'compiledFiles':manifest['files'],'moduleLoadExitCode':completed.returncode}
 if name=='provider':
  preflight=subprocess.run(base+['dist/scripts/ugv-zmq/preflight.js'],capture_output=True,text=True)
  output=root/'image-provider-preflight-build-repaired.json'
  with output.open('x') as stream:stream.write(preflight.stdout)
  report=json.loads(preflight.stdout)
  if preflight.returncode!=2 or report['contract']['status']!='verified' or len(report['contract']['checkedFiles'])!=17 or len(report['missing'])!=12 or report['g0Ready']:
   raise RuntimeError('EXPECTED_G0_REJECTION_NOT_PROVEN')
  item['preflight']={'exitCode':preflight.returncode,'expectedExitCode':2,'checkedFiles':17,'g0Ready':False,'missing':report['missing'],'reportSha256':hashlib.sha256(output.read_bytes()).hexdigest()}
 result['images'].append(item)
 print(json.dumps({'component':name,'compiledFiles':len(manifest['files']),'modulesLoaded':len(manifest['loaded']),'matched':True}))
output=root/'image-proof-build-repaired.json'
with output.open('x') as stream:json.dump(result,stream,indent=2);stream.write('\n')
print(json.dumps({'status':'passed','report':str(output),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
