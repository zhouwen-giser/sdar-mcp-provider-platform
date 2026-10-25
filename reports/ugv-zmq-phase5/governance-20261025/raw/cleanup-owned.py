#!/usr/bin/env python3
import datetime,json,subprocess
from pathlib import Path

root=Path('/mnt/data/ugv-zmq-phase5-governance-20261025')
gate=Path('/home/sz/code/skill-driven-agent-runtime-zmq-phase5/reports/runtime-semantic-closure/sdar-verify-90b419a7-c47d-481c-9195-77fb58fd8b0a/run.json')
run=json.loads(gate.read_text())
assert run['exitCode']==run['cleanupExitCode']==0 and run['inputUnchanged'] and run['baselineUnchanged']
ownership=json.loads((root/'fixture-ownership.json').read_text())
assert ownership['runId']=='zmqgov-1eccc345ef7f'
mqtt=json.loads((root/'mqtt-ownership.json').read_text())
assert mqtt['owner']=='zmq-phase5-governance'
expected=ownership['containers']+[{'name':'zmqgov-1eccc345ef7f-mqtt','id':mqtt['containerId']}]
checked=[]
for item in expected:
 assert item['name'].startswith(ownership['runId']+'-')
 current=json.loads(subprocess.check_output(['docker','inspect',item['name']]))[0]
 assert current['Id']==item['id'], 'OWNERSHIP_ID_CHANGED'
 checked.append({'name':item['name'],'id':current['Id'],'mounts':[{'type':m['Type'],'destination':m['Destination'],'name':m.get('Name')}for m in current['Mounts']]})
results=[]
for item in checked:
 stop=subprocess.run(['docker','stop','--time','10',item['id']],capture_output=True,text=True)
 assert stop.returncode==0,'OWNED_STOP_FAILED'
 remove=subprocess.run(['docker','rm','--volumes',item['id']],capture_output=True,text=True)
 assert remove.returncode==0,'OWNED_REMOVE_FAILED'
 missing=subprocess.run(['docker','inspect',item['id']],capture_output=True,text=True)
 assert missing.returncode!=0,'OWNED_CONTAINER_REMAINS'
 results.append({**item,'stopExitCode':stop.returncode,'removeExitCode':remove.returncode,'removed':True})
record={'schemaVersion':'ugv.zmq-owned-fixture-cleanup/1','completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'owner':ownership['runId'],'exitCode':0,'containers':results,'sharedServiceCommands':0,'credentialsRetainedOnlyUntilEvidenceRedaction':True}
with (root/'fixture-cleanup-final.json').open('x')as f:json.dump(record,f,indent=2);f.write('\n')
print(json.dumps({'status':'cleaned','ownedContainers':len(results),'sharedServiceCommands':0}))
