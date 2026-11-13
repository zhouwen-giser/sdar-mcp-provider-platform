from pathlib import Path
import subprocess,json,hashlib,datetime,socket,time,os,urllib.request
root=Path('/home/sz/.smpp-debug/zmq-v151-formal-20261113');repo=Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');proof={'schemaVersion':'ugv.zmq-v151-formal-cutover/1','startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'authorization':'user_approved_formal_cutover_and_shortened_stability','sourceCommit':'ada745829c635b9bb56d6017c2c2faf7f31e544e','steps':[],'physicalControlActions':0,'pmsAndSdarBindingModified':False}
def save():
 p=root/'cutover.json';p.write_text(json.dumps(proof,ensure_ascii=False,indent=2)+'\n');p.chmod(0o600)
def run(cmd,timeout=55,env=None):
 r=subprocess.run(cmd,cwd=repo,capture_output=True,text=True,timeout=timeout,env=env);i=len(proof['steps']);p=root/f'cutover-{i:02d}.log';p.write_text(r.stdout+r.stderr);p.chmod(0o600);proof['steps'].append({'command':cmd,'exitCode':r.returncode,'log':p.name,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()});save();print(json.dumps({'step':i,'operation':cmd[:5],'exitCode':r.returncode}),flush=True)
 if r.returncode:raise RuntimeError('CUTOVER_STEP_FAILED_'+str(i))
 return r.stdout
def wait_http(port,path='/health/ready'):
 deadline=time.monotonic()+40
 while time.monotonic()<deadline:
  try:
   with urllib.request.urlopen(f'http://127.0.0.1:{port}'+path,timeout=2) as r:
    if r.status==200:return
  except Exception:pass
  time.sleep(.5)
 raise RuntimeError('FORMAL_HEALTH_TIMEOUT_'+str(port))
accept=json.loads((root/'accepted-soak/operator-acceptance.json').read_text());assert accept['stabilityAccepted'] and not accept['actualFull24HoursObserved']
idle=json.loads((root/'handoff-before.json').read_text());assert idle['databaseIdle'] and idle['unresolvedNativeOccupancy']==0
source=json.loads((root/'source-preflight.json').read_text());assert source['stationaryVerified'] and source['scene']['scene']=='yuan_qu'
proof['sceneQualifiedForPlanning']=source['scene']['qualifiedForPlanning'];proof['retainedSiteBlockers']=[] if source['scene']['qualifiedForPlanning'] else ['UGV_PLANNER_SCENE_UNAVAILABLE']
# The CLI already fenced exact old control writer IDs and committed an empty-task grant.
run(['node','--import','tsx','scripts/ugv-zmq/site-control-handoff.ts','verify','--config',str(root/'handoff-config.json'),'--grant',str(root/'handoff-grant.json')])
names=['smpp-zmq-v15-candidate-console-1','smpp-zmq-v15-candidate-runtime-1','smpp-zmq-v15-candidate-provider-1','smpp-zmq-site-formal-console-1']
run(['docker','update','--restart=no',*names]);run(['docker','stop','--time','20',*names],timeout=60)
# Every target listener must now be released. No unrelated process is displaced.
for port in [7010,19108,19100,19101]:
 with socket.socket() as s:
  if s.connect_ex(('127.0.0.1',port))==0:raise RuntimeError('FORMAL_PORT_CONFLICT_'+str(port))
env=dict(os.environ,SMPP_ZMQ_OWNER_CONFIG_FILE=str(root/'owner.json'),UGV_ZMQ_SITE_PROFILE_FILE=str(root/'profile.json'),UGV_ZMQ_SITE_HANDOFF_REPORT=str(root/'handoff-fenced.json'))
run(['node','--import','tsx','scripts/ugv-zmq/site-handoff-check.ts'],env=env)
idle=json.loads((root/'handoff-fenced.json').read_text());assert idle['databaseIdle'] and idle['liveLeases']==0
compose=['docker','compose','--env-file',str(root/'formal/site-images.env'),'-p','smpp-zmq-site-formal','-f','deploy/ugv-zmq/site-control/compose.formal.yaml','-f',str(root/'formal/pms-readonly-override.json')]
run([*compose,'config','--quiet'])
run([*compose,'up','-d','--no-deps','--force-recreate','--no-build','--pull','never','provider'])
end=time.monotonic()+20
while time.monotonic()<end:
 with socket.socket() as s:
  if s.connect_ex(('127.0.0.1',7010))==0:break
 time.sleep(.5)
else:raise RuntimeError('FORMAL_PROVIDER_START_FAILED')
run([*compose,'up','-d','--no-deps','--force-recreate','--no-build','--pull','never','runtime']);wait_http(19100)
run([*compose,'up','-d','--no-deps','--force-recreate','--no-build','--pull','never','console']);wait_http(19101)
rows=json.loads(subprocess.check_output(['docker','inspect','smpp-zmq-site-formal-provider-1','smpp-zmq-site-formal-runtime-1','smpp-zmq-site-formal-console-1']))
proof.update(completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),status='formal_services_replaced_pending_readonly_acceptance',formalPorts=[19100,19101],catalogProfile='zmq_v1_5_1_site_control_15',newContainers=[{'id':r['Id'],'name':r['Name'],'image':r['Image'],'startedAt':r['State']['StartedAt'],'restartCount':r['RestartCount']}for r in rows]);save();print(json.dumps({'status':proof['status'],'ports':proof['formalPorts'],'catalogProfile':proof['catalogProfile'],'physicalControlActions':0}),flush=True)
