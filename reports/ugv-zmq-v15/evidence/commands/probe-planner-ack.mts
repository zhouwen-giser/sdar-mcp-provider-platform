import {readFileSync,writeFileSync} from 'node:fs';import{createHash}from'node:crypto';
import pg from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/node_modules/pg/lib/index.js';
const {Pool}=pg;const root='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform';
const c=JSON.parse(readFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/candidate/provider.json','utf8'));
const endpoint=new URL(c.profile.planner.endpoint).href;const key=createHash('sha256').update(endpoint).digest('hex');const p=new Pool({connectionString:c.observationDatabaseUrl,max:1,statement_timeout:3000});const client=await p.connect();let locked=false;
try{
 locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,790028)) locked',[key])).rows[0].locked;if(!locked)throw Error('PLANNER_BUSY');
 const packets=[];const params={target:'ugv',points:[[(106.81307318-106.81485)*111320,(29.7195-29.71952521)*110540]],density:'adaptive'};
 await new Promise<void>((resolve)=>{const w=new WebSocket('ws://192.168.2.63:7879/socket.io/?EIO=4&transport=websocket');const timer=setTimeout(()=>{w.close();resolve();},3000);let requested=false;
  w.addEventListener('message',({data})=>{if(typeof data!=='string'||data.length>1_000_000)return;if(data.startsWith('0'))w.send('40');else if(data==='2')w.send('3');else if(data.startsWith('40')&&!requested){requested=true;w.send('421'+JSON.stringify(['plan_route',params]));}else if(data.startsWith('43')){packets.push({type:'socketio_ack',body:data.slice(2),sha256:createHash('sha256').update(data).digest('hex')});}else if(data.startsWith('42')){try{const event=JSON.parse(data.slice(2));packets.push({type:'event',name:event[0],bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),...(event[0]==='route_candidates'?{value:event[1]}:{})});}catch{}}});
 w.addEventListener('error',()=>{packets.push({type:'transport_error'});clearTimeout(timer);w.close();resolve();});});
 const record={verifiedAt:new Date().toISOString(),endpoint,serializedWithProvider:true,commandIntent:'route_preview_only',request:params,packets,physicalControlActions:0};writeFileSync(root+'/reports/ugv-zmq-v15/evidence/attempt-2/planner-socketio-ack.json',JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record));
}finally{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,790028))',[key]);client.release();await p.end();}
