import json, urllib.request, urllib.error, datetime, sys, time, uuid
meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{'name':'smpp-live-integration-check','version':'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{'extensions':{'io.modelcontextprotocol/tasks':{}}}}
def rpc(method,params):
 params={**params,'_meta':{**meta,**params.get('_meta',{})}}
 req=urllib.request.Request('http://127.0.0.1:19100/mcp',data=json.dumps({'jsonrpc':'2.0','id':1,'method':method,'params':params}).encode(),headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','mcp-protocol-version':'2026-07-28','mcp-method':method,'mcp-name':params.get('name',params.get('taskId',method)),'x-sdar-subject':'smpp-live-integration-check','x-sdar-tenant':'default'})
 try:
  with urllib.request.urlopen(req,timeout=30) as r: return {'httpStatus':r.status,'body':json.load(r)}
 except urllib.error.HTTPError as e: return {'httpStatus':e.code,'body':json.load(e)}


owned=[]
def log(event,**data): print(json.dumps({'event':event,'time':datetime.datetime.now(datetime.timezone.utc).isoformat(),**data}),flush=True)
def call(name,args):
 p={'name':name,'arguments':{'resourceId':'vehicle:ugv',**args},'_meta':{'io.sdar/taskExecution':{'profileVersion':'1.0','idempotencyKey':'sim-fixed-chain-'+str(uuid.uuid4())}}}
 r=rpc('tools/call',p);log('call',params=p,response=r)
 v=r.get('body',{}).get('result',{});t=v.get('taskId')
 if t: owned.append(t)
 return v
def poll(t,seconds=40,locked=False):
 deadline=time.monotonic()+seconds
 while True:
  r=rpc('tasks/get',{'taskId':t});log('poll',response=r)
  v=r.get('body',{}).get('result',{})
  if v.get('status') in ['completed','failed','cancelled','input_required','input-required']: return v
  if locked and v.get('statusMessage')=='UGV_TARGET_LOCK_CONFIRMED': return v
  if time.monotonic()>=deadline: return v
  time.sleep(0.5)
try:
 nav=call('vehicle_navigate',{'mission':{'type':'point','target':{'longitude':106.81302,'latitude':29.71843}}})
 if not nav.get('taskId') or poll(nav['taskId'],70).get('status')!='completed': raise RuntimeError('APPROACH_NOT_COMPLETED')
 area={'polygon':[{'longitude':106.81271124,'latitude':29.71821513},{'longitude':106.81268055,'latitude':29.71864445},{'longitude':106.81323289,'latitude':29.71869495},{'longitude':106.81345382,'latitude':29.71816462}]}
 v=call('vehicle_area_recon',{'scanMode':'area','scanCount':0,'area':area})
 if not v.get('taskId'): raise RuntimeError('RECON_NOT_ACCEPTED')
 target=None
 for i in range(100):
  r=rpc('tools/call',{'name':'vehicle_get_targets','arguments':{'resourceId':'vehicle:ugv'}});log('target_sample',response=r)
  targets=r.get('body',{}).get('result',{}).get('structuredContent',{}).get('targets',[])
  if targets:
   selected=min(targets,key=lambda t:t.get('distanceM',1e9));target=str(selected['targetId']);log('selected_target',target=selected);break
  time.sleep(0.25)
 if target is None: raise RuntimeError('NO_DISCOVERED_TARGET')
 # Keep the scanner alive: device lock itself pauses scanning and takes the gimbal.
 track=call('vehicle_track_target',{'targetId':target})
 if not track.get('taskId'): raise RuntimeError('TRACK_NOT_ACCEPTED')
 lock=poll(track['taskId'],20,locked=True)
 if lock.get('statusMessage')!='UGV_TARGET_LOCK_CONFIRMED': raise RuntimeError('LOCK_NOT_CONFIRMED')
 fire=call('vehicle_fire_weapon',{'targetId':target,'engagementMode':'single','requireConfirmation':True})
 if not fire.get('taskId'): raise RuntimeError('FIRE_NOT_ACCEPTED')
 waiting=poll(fire['taskId'],10)
 if waiting.get('status') not in ['input_required','input-required']: raise RuntimeError('FIRE_CONFIRMATION_NOT_REQUESTED')
 log('confirm_simulation_only',response=rpc('tasks/update',{'taskId':fire['taskId'],'inputResponses':{'fire_confirmation':{'action':'accept','content':{'confirmed':True}}}}))
 end=poll(fire['taskId'],45)
 log('chain_result',success=end.get('status')=='completed',targetId=target,fireTaskId=fire['taskId'],final=end)
except Exception as e: log('chain_error',message=str(e))
finally:
 # Stop through the coordinated emergency tool; do not cancel recon before tracking.
 stop=call('vehicle_emergency_stop',{})
 if stop.get('taskId'): poll(stop['taskId'],40)
 for t in owned:
  try: log('final_task',response=rpc('tasks/get',{'taskId':t}))
  except Exception as e: log('final_read_error',taskId=t,message=str(e))
