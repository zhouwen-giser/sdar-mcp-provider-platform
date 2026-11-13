import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
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
writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/localization-followup-20261113-0952/raw-localization.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,samples:samples.map(({wireBase64,...s})=>s)}));if(samples.length<2)process.exitCode=2;
