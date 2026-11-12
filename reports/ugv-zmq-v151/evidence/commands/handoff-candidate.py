import pathlib,json,subprocess,os,signal,time,hashlib,socket,datetime,shutil
root=pathlib.Path('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform');private=pathlib.Path('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112');candidate=private/'candidate';old=private.parent/'candidate';evidence=root/'reports/ugv-zmq-v151/evidence';report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'physicalControlActions':0,'formalServicesChanged':False,'steps':[]}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def env(path):return dict(line.split('=',1) for line in path.read_text().splitlines() if '=' in line and not line.startswith('#'))
images=json.loads((evidence/'attempt-1/images-build.json').read_text());assert images['exitCode']==0
for folder,labels in [('attempt-1',['typecheck','lint','build','frozen-mcp','native-contracts','unit','catalog-v151-catalog','manifest-memory']),('attempt-3',['typecheck','lint','postgres','v15-control','v151-control','console-tests','browser'])]:
 for label in labels:assert json.loads((evidence/folder/(label+'.json')).read_text())['exitCode']==0,(folder,label)
assert json.loads((evidence/'image-contract-smoke.json').read_text())['exitCode']==0
original=env(old/'site-images.env');values=env(candidate/'site-images.env')
for image in images['images']:values['SITE_'+image['role'].upper()+'_IMAGE']=image['id']
(candidate/'site-images.env').write_text(''.join(k+'='+v+'\n' for k,v in values.items()));(candidate/'site-images.env').chmod(0o600)
protectedKeys=['SITE_GOWM_URL_FILE','SITE_JWT_SECRET_FILE','SITE_CONSOLE_DATABASE_URL_FILE','SITE_CONSOLE_CREDENTIALS_FILE','SITE_CONSOLE_AUTHORIZATION_FILE']
protected={k:{'path':original[k],'sha256':digest(pathlib.Path(original[k]))} for k in protectedKeys if k in original and pathlib.Path(original[k]).is_file()}
report['protectedBefore']=protected
for k in ['SITE_RUNTIME_CONFIG_DIR','SITE_RUNTIME_DATA_DIR']:
 assert original.get(k)==values.get(k),k
report['preservedMounts']={k:original.get(k) for k in ['SITE_RUNTIME_CONFIG_DIR','SITE_RUNTIME_DATA_DIR']}
monitor=private.parent/'stability-24h-2';run=json.loads((monitor/'run.json').read_text());names=[c['name'] for c in run['containers']]
current=json.loads(subprocess.check_output(['docker','inspect',*names]));baseline={c['id']:c for c in run['containers']}
for c in current:
 assert c['Id'] in baseline and c['Config']['Labels']['com.docker.compose.project']=='smpp-zmq-v15-candidate'
 assert c['State']['Running'] and not c['State']['OOMKilled'] and c['RestartCount']==baseline[c['Id']]['restartCount']
 assert c['Image']==baseline[c['Id']]['image']
report['oldContainers']=[{'id':c['Id'],'name':c['Name'],'image':c['Image'],'restartCount':c['RestartCount']} for c in current]
assert json.loads((old/'provider.json').read_text())['mode']=='site_readonly'
proc=json.loads((private.parent/'stability-process-2.json').read_text());pid=proc['pid'];cmd=pathlib.Path('/proc')/str(pid)/'cmdline'
if cmd.exists():
 text=cmd.read_bytes().replace(b'\0',b' ').decode();assert 'v15-stability.py' in text and str(monitor) in text
 os.kill(pid,signal.SIGTERM)
 for _ in range(50):
  if not cmd.exists():break
  time.sleep(.1)
summary=json.loads((monitor/'summary.json').read_text());lines=(monitor/'samples.ndjson').read_text().splitlines();previous='0'*64;hashes=[]
for i,line in enumerate(lines):
 item=json.loads(line);assert item['previousSha256']==previous and item['sample']==i
 previous=hashlib.sha256(line.encode()).hexdigest();hashes.append(previous)
assert hashes[summary['samples']-1]==summary['lastSampleSha256']
last=json.loads(lines[summary['samples']-1]);cfg=json.loads((candidate/'provider.json').read_text());cfg['observerSettings']['recoveryPredecessor']={'partitionHash':last['partitionHash'],'sessionId':last['sessionId']};(candidate/'provider.json').write_text(json.dumps(cfg,indent=2)+'\n')
sealed={'status':'superseded_before_24h','reason':'authorized SMPP-only 1.5.1 interoperability image replacement','elapsedSeconds':summary['elapsedSeconds'],'samples':len(lines),'acknowledgedSamples':summary['samples'],'hashChainVerified':True,'lastJournalSha256':previous,'qualifies24h':False,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(monitor/'superseded.json').write_text(json.dumps(sealed,indent=2)+'\n');dest=evidence/'superseded-ca33761';dest.mkdir(exist_ok=True)
for name in ['run.json','summary.json','samples.ndjson','superseded.json']:shutil.copy2(monitor/name,dest/name)
report['supersededSoak']=sealed
log=(evidence/'candidate-handoff.log').open('wb')
def compose(base,*args):
 command=['docker','compose','--env-file',str(base/'site-images.env'),'-p','smpp-zmq-v15-candidate','-f','deploy/ugv-zmq/site-readonly/compose.yaml','-f',str(base/'override.json'),*args]
 start=time.monotonic();p=subprocess.run(command,cwd=root,stdout=log,stderr=subprocess.STDOUT);report['steps'].append({'command':command,'exitCode':p.returncode,'seconds':round(time.monotonic()-start,3)});log.flush()
 if p.returncode:raise RuntimeError('CANDIDATE_COMPOSE_FAILED')
compose(old,'stop','-t','20','console','runtime','provider')
for port in [7012,19110,19111]:
 s=socket.socket();s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 try:s.bind(('127.0.0.1',port))
 except OSError as e:raise RuntimeError('CANDIDATE_PORT_NOT_RELEASED_'+str(port)) from e
 finally:s.close()
for role,port in [('provider',7012),('runtime',19110),('console',19111)]:
 compose(candidate,'up','-d','--no-deps','--force-recreate',role)
 for _ in range(100):
  try:
   with socket.create_connection(('127.0.0.1',port),timeout=.3):break
  except OSError:time.sleep(.5)
 else:raise RuntimeError('CANDIDATE_START_TIMEOUT_'+role)
 print(json.dumps({'role':role,'port':port,'listening':True}),flush=True)
now=json.loads(subprocess.check_output(['docker','inspect',*names]));report['newContainers']=[{'id':c['Id'],'name':c['Name'].lstrip('/'),'image':c['Image'],'restartCount':c['RestartCount'],'oomKilled':c['State']['OOMKilled'],'startedAt':c['State']['StartedAt']} for c in now]
report['protectedAfter']={k:{'path':v['path'],'sha256':digest(pathlib.Path(v['path']))} for k,v in protected.items()};assert report['protectedBefore']==report['protectedAfter']
report['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();report['status']='candidate_replaced_readonly_formal_unchanged';report['sourceCommit']=images['sourceCommit'];report['profile']='zmq_v1_5_1_readonly_15'
log.close();report['logSha256']=digest(evidence/'candidate-handoff.log');(evidence/'candidate-handoff.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'status':report['status'],'newContainers':report['newContainers'],'protectedFilesUnchanged':True}),flush=True)
