from pathlib import Path
import json,hashlib,shutil,copy,uuid,subprocess
root=Path('/home/sz/.smpp-debug/zmq-v151-formal-20261113');old=Path('/home/sz/.smpp-debug/ugv-zmq-formal-tools-20261102/formal');candidate=Path('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/candidate');root.chmod(0o700)
def loadenv(p):return dict(line.split('=',1)for line in p.read_text().splitlines()if line and not line.startswith('#') and '=' in line)
def save(p,data):
 p.parent.mkdir(exist_ok=True,mode=0o700);p.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n' if isinstance(data,(dict,list)) else data);p.chmod(0o600)
def saveenv(p,d):save(p,''.join(k+'='+v+'\n'for k,v in d.items()))
se=loadenv(old/'site-images.env');cs=loadenv(candidate/'site-images.env')
protected={k:{'path':v,'sha256':hashlib.sha256(Path(v).read_bytes()).hexdigest()}for k,v in se.items()if k in ['SITE_GOWM_URL_FILE','SITE_HANDOFF_GRANT_FILE','SITE_JWT_SECRET_FILE','SITE_CONSOLE_DATABASE_URL_FILE','SITE_CONSOLE_CREDENTIALS_FILE','SITE_CONSOLE_AUTHORIZATION_FILE']}
oldcfg=json.loads((old/'provider.json').read_text());cfg=json.loads((candidate/'provider.json').read_text());cfg.update(mode='site_control',port=7010,host='127.0.0.1',handoffGrantFile='/run/secrets/handoff.json',management={'port':19108,'jwtSecretFile':'/run/secrets/site-jwt.key'})
cfg['observerSettings'].update(diagnosticPartition='site-control-v151-formal-20261113',recoveryPredecessor={'partitionHash':'e19841fabee8695bc38d846308230e945e379b8e2068433f45bd7557a3d4a276','sessionId':'6ef0b8ff-e932-4789-9d18-9ca29376b563'})
control=copy.deepcopy(oldcfg['controlSettings']);control.update(catalogProfile='zmq_v1_5_1_site_control_15',contractSha256=cfg['contractSha256'],observerSessionId=str(uuid.uuid4()),observerPartitionHash='0'*64,handoffGrantHash='0'*64)
cfg['controlSettings']=control
formal=root/'formal';formal.mkdir(mode=0o700,exist_ok=True);save(formal/'provider.json',cfg);save(root/'profile.json',cfg['profile'])
for name in ['provider.env','runtime.env','console.env']:shutil.copyfile(old/name,formal/name);(formal/name).chmod(0o600)
for key in ['SITE_PROVIDER_IMAGE','SITE_RUNTIME_IMAGE','SITE_CONSOLE_IMAGE']:se[key]=cs[key]
se.update(SITE_PROVIDER_ENV=str(formal/'provider.env'),SITE_RUNTIME_ENV=str(formal/'runtime.env'),SITE_CONSOLE_ENV=str(formal/'console.env'),SITE_PROVIDER_CONFIG=str(formal/'provider.json'),SITE_HANDOFF_GRANT_FILE=str(root/'handoff-grant.json'))
saveenv(formal/'site-images.env',se)
shutil.copyfile(old/'pms-readonly-override.json',formal/'pms-readonly-override.json')
shutil.copyfile('/home/sz/.smpp-debug/ugv-zmq-formal-tools-20261102/owner-current.json',root/'owner.json');(root/'owner.json').chmod(0o600)
writers=json.loads(subprocess.check_output(['docker','inspect','smpp-zmq-site-formal-runtime-1','smpp-zmq-site-formal-provider-1']))
save(root/'handoff-config.json',{'ownerEnvironmentFile':str(root/'owner.json'),'profileFile':str(root/'profile.json'),'oldWriterContainers':[c['Id']for c in writers]})
backup=root/'before';backup.mkdir(mode=0o700,exist_ok=True)
for name in ['provider.json','provider.env','runtime.env','console.env','site-images.env','pms-readonly-override.json']:shutil.copyfile(old/name,backup/name);(backup/name).chmod(0o600)
containers=json.loads(subprocess.check_output(['docker','inspect','smpp-zmq-site-formal-provider-1','smpp-zmq-site-formal-runtime-1','smpp-zmq-site-formal-console-1','gowm-analysis-dev-f3dc6f4b8e-smpp-runtime-1','smpp-zmq-v15-candidate-provider-1','smpp-zmq-v15-candidate-runtime-1','smpp-zmq-v15-candidate-console-1']))
save(backup/'containers.json',containers)
save(root/'configuration-proof.json',{'sourceCommit':'ada745829c635b9bb56d6017c2c2faf7f31e544e','profile':'zmq_v1_5_1_site_control_15','mode':'site_control','newObservationPartition':cfg['observerSettings']['diagnosticPartition'],'sourceProducerEpoch':None,'receiverBoundary':'explicit_operator_authorized_formal_handoff_not_automatic_clock_reset','protectedBefore':protected,'providerBinding':cfg['profile']['providerBinding'],'sameDatabaseUrl':cfg['databaseUrl']==oldcfg['databaseUrl'],'sameObservationDatabaseUrl':cfg['observationDatabaseUrl']==oldcfg['observationDatabaseUrl'],'images':{k:v for k,v in se.items()if k in ['SITE_PROVIDER_IMAGE','SITE_RUNTIME_IMAGE','SITE_CONSOLE_IMAGE']},'oldWriters':[{'id':c['Id'],'image':c['Image']}for c in writers],'preservedPmsGateway':True,'sdarModified':False,'upstreamModified':False})
print(json.dumps({'prepared':str(formal),'profile':control['catalogProfile'],'sameDatabase':cfg['databaseUrl']==oldcfg['databaseUrl'],'sameObservationDatabase':cfg['observationDatabaseUrl']==oldcfg['observationDatabaseUrl'],'oldWriterIds':[c['Id']for c in writers],'protectedFiles':len(protected)}))
