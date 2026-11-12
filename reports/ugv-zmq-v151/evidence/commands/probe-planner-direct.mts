import{readFileSync,writeFileSync}from'node:fs';
import{createHash}from'node:crypto';
import{WebSocket}from'/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/node_modules/ws/wrapper.mjs';
import{DashboardV2Planner}from'/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/provider-adapter-kit/src/dashboard-v2-planner.ts';
const root='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform';
const profile=JSON.parse(readFileSync(root+'/deploy/ugv-zmq/v151/profile.example.json','utf8'));
const state=await new Promise<any>((resolve,reject)=>{const s=new WebSocket('ws://192.168.2.63:7879/socket.io/?EIO=4&transport=websocket',{maxPayload:1048576});const t=setTimeout(()=>{s.terminate();reject(Error('STATE_TIMEOUT'));},4000);s.on('error',reject);s.on('message',b=>{const x=b.toString();if(x.startsWith('0'))s.send('40');else if(x==='2')s.send('3');else if(x.startsWith('42')){const[n,d]=JSON.parse(x.slice(2));if(n==='state'&&d.mission_context&&d.actors?.ugv?.available){clearTimeout(t);s.removeAllListeners();s.on('error',()=>{});s.terminate();resolve(d);}}});});
const actor=state.actors.ugv;const roads=JSON.parse(readFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/roads-readonly.json','utf8'));
const dist=(p:number[])=>Math.hypot(p[0]-actor.position_x,p[1]-actor.position_y);
const sorted=roads.body.roads.map((r:any)=>({...r,near:Math.min(...r.points.map(dist))})).sort((a:any,b:any)=>a.near-b.near);
let choice:any;
for(const r of sorted){const targets=r.points.filter((p:number[])=>dist(p)>=50&&dist(p)<=120);if(targets.length&&r.near<30){choice={roadId:r.id,startRoadDistance:r.near,mapPoint:targets.sort((a:number[],b:number[])=>dist(a)-dist(b))[0]};break;}}
if(!choice)throw Error('NO_QUALIFIED_READONLY_PROBE_DESTINATION');
const planner=new DashboardV2Planner(profile.planner.endpoint,profile.planner);
const position=planner.frame.toGnss(...choice.mapPoint);
const input={start:{longitude:actor.gnss_lon,latitude:actor.gnss_lat},waypoints:[{longitude:position.longitude,latitude:position.latitude}],density:'adaptive' as const};
const proof:any={verifiedAt:new Date().toISOString(),intent:'route_preview_only_no_navigation_task',physicalControlActions:0,roadSourceSha256:roads.sha256,choice,input};
try{proof.result=await planner.plan(input);proof.status='verified';proof.responseSha256=createHash('sha256').update(proof.result.sourceMessage).digest('hex');}
catch(e){proof.status='blocked';proof.reason=e instanceof Error?e.message:String(e);process.exitCode=2;}
writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/planner-direct.json',JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({status:proof.status,reason:proof.reason,choice,pointCount:proof.result?.waypoints.length,context:proof.result?.context,responseSha256:proof.responseSha256}));
