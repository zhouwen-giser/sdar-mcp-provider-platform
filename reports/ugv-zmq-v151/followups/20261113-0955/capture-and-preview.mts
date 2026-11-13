import {createRequire} from 'node:module';
import {writeFileSync,readFileSync} from 'node:fs';
import {Mcp,toolContent} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/mcp.ts';
import {createHash} from 'node:crypto';
import {decodeChassisPublication} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/vehicle-zmq-contract/src/chassis-site.ts';
const require=createRequire('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/package.json');
const {Subscriber}=require('zeromq');
const socket=new Subscriber({receiveTimeout:250,linger:0,receiveHighWaterMark:32});
const samples:any[]=[];const errors:any[]=[];let received=0;
socket.connect('tcp://192.168.2.63:11001');socket.subscribe('ipc_message');
const until=Date.now()+4000;
try{while(Date.now()<until&&samples.length<2){let frames:Buffer[];try{frames=await socket.receive();}catch(e:any){if(e.code==='EAGAIN')continue;throw e;}received++;
 try{if(frames.length!==1)throw Error('MULTIPART_INVALID');const wire=frames[0]!;const parsed=decodeChassisPublication(wire,{systemId:'1',protocolVersion:'2.1',publicationFraming:'prefix_business_length_crc'});
 if(parsed.body.type==='localization')samples.push({receivedAt:new Date().toISOString(),sha256:createHash('sha256').update(wire).digest('hex'),wireBase64:wire.toString('base64'),parsed});
 }catch(e:any){if(errors.length<4)errors.push({error:e.message});}
}}finally{socket.close();}
const result={at:new Date().toISOString(),scope:'SUB_only_no_command_socket',endpoint:'tcp://192.168.2.63:11001',publicationFraming:'prefix_business_length_crc',received,samples,errors,physicalControlActions:0};
writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/localization-followup-20261113-0952/raw-localization-for-preview.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,samples:samples.map(({wireBase64,...s})=>s)}));if(samples.length<2)process.exitCode=2;

if(samples.length>=2){
const latest=samples[samples.length-1].parsed.body;
const mcp=new Mcp('http://127.0.0.1:19110/mcp',{'x-sdar-execution-mode':'live'});
const input={resourceId:'vehicle:ugv',start:{longitude:latest.longitude,latitude:latest.latitude},waypoints:JSON.parse(readFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/planner-direct.json','utf8')).input.waypoints,density:'adaptive'};
const proof:any={at:new Date().toISOString(),intent:'readonly_preview_with_independently_observed_fresh_start',scope:'does_not_release_projector_quarantine_or_control_admission',sourceSample:result.samples[result.samples.length-1],input,physicalControlActions:0};
try{proof.result=toolContent(await mcp.tool('vehicle_zmq_plan_route',input));if(proof.result.schemaVersion!=='ugv.zmq-route-preview/2'||proof.result.adoption!=='preview_only')throw Error('INVALID_PREVIEW');proof.status='verified';}
catch(error:any){proof.status='blocked';proof.reason=error.message;process.exitCode=2;}
writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/localization-followup-20261113-0952/source-recovery-preview.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({status:proof.status,reason:proof.reason,context:proof.result?.context,points:proof.result?.waypoints?.length,sourceMessageSha256:proof.result?.sourceMessageSha256,physicalControlActions:0}));
}
