import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Mcp,toolContent,protocolMeta} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/mcp.ts';
import {nativeCatalogReason} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/shared/zmq-native.ts';
const output='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/reports/ugv-zmq-v15/followups/20261112-1505/candidate-live.json';
const mcp=new Mcp('http://127.0.0.1:19110/mcp',{'x-sdar-execution-mode':'live'}),resourceId='vehicle:ugv';
const list=await mcp.rpc('tools/list'),tools=list.tools as Parameters<typeof nativeCatalogReason>[0];
if(tools.length!==15||nativeCatalogReason(tools,resourceId)!==null)throw Error('CANDIDATE_CATALOG_INVALID');
const caps=toolContent(await mcp.tool('vehicle_get_capabilities',{resourceId}));
const state=toolContent(await mcp.tool('vehicle_get_state',{resourceId}));
const observations=state.observations as {component:string;receiptFresh:boolean;observation:{key:string;protocolVersion:string;data:Record<string,unknown>;position?:{longitude:number;latitude:number}}}[];
const header=observations.find((o)=>o.observation.key==='frame_header');
if(!header||!header.receiptFresh)throw Error('LIVE_FRAME_HEADER_NOT_FRESH');
let block=toolContent(await mcp.tool('vehicle_zmq_get_frame',{resourceId,cameraId:header.observation.data.camera_id,frameId:header.observation.data.frame_id}));
const first=block,hash=createHash('sha256');let total=0,blocks=0;
for(;;){const bytes=Buffer.from(String(block.dataBase64),'base64');if(createHash('sha256').update(bytes).digest('hex')!==block.chunkSha256||block.offset!==total||bytes.length!==block.chunkBytes)throw Error('FRAME_CHUNK_INVALID');hash.update(bytes);total+=bytes.length;blocks++;if(block.nextOffset===null)break;block=toolContent(await mcp.tool('vehicle_zmq_get_frame',{resourceId,retrievalId:first.retrievalId,offset:block.nextOffset}));}
if(hash.digest('hex')!==first.sha256||total!==first.byteLength)throw Error('FRAME_HASH_INVALID');
const spoofed=new Mcp(mcp.url,{'x-sdar-execution-mode':'live','x-sdar-tenant-id':'forged','x-sdar-subject-id':'forged'});
const replay=toolContent(await spoofed.tool('vehicle_zmq_get_frame',{resourceId,retrievalId:first.retrievalId,offset:0}));
if(replay.sha256!==first.sha256)throw Error('ANONYMOUS_IDENTITY_OVERRIDE_NOT_IGNORED');
let invalidJwtRejected=false;try{await new Mcp(mcp.url,{'x-sdar-execution-mode':'live',authorization:'Bearer invalid-token'}).rpc('tools/list');}catch{invalidJwtRejected=true;}
if(!invalidJwtRejected)throw Error('INVALID_JWT_NOT_REJECTED');
const position=observations.find((o)=>o.observation.key==='localization'&&o.receiptFresh)?.observation.position;
let planner:Record<string,unknown>={status:'not_attempted',reason:'POSITION_NOT_FRESH'};
if(position){try{const result=toolContent(await mcp.tool('vehicle_zmq_plan_route',{resourceId,start:{longitude:position.longitude,latitude:position.latitude},waypoints:[{longitude:106.813064505,latitude:29.720529508}],density:'adaptive'}));planner={status:'passed',schemaVersion:result.schemaVersion,adoption:result.adoption,correlation:result.correlation,points:(result.waypoints as unknown[]).length,sourceMessageSha256:result.sourceMessageSha256};}catch(error){planner={status:'not_accepted',reason:error instanceof Error?error.message:'UNKNOWN'};}}
const record={sourceCommit:'ca33761c1d5c9c0a6cce3acc9105faa1735832da',verifiedAt:new Date().toISOString(),runtime:'http://127.0.0.1:19110/mcp',profile:caps.catalogProfile,tools:tools.length,readOnly:caps.controlAvailable===false,anonymous:true,invalidJwtRejected,identityOverrideIgnored:true,archive:state.archive,archiveGaps:state.archiveGaps,channels:state.channels,sessionId:state.sessionId,partitionHash:state.partitionHash,protocols:[...new Set(observations.map((o)=>o.component+'@'+o.observation.protocolVersion))],frame:{metadata:first.metadata,sha256:first.sha256,byteLength:total,blocks,reference:first.reference,overlays:(first.overlays as unknown[]).length,diagnostics:first.diagnostics,rawImagePersisted:false},planner,physicalControlActions:0,acceptanceScope:'readonly_catalog_eo_effect_frame',overallFieldAcceptance:state.channels.chassis.receiptFresh?'ready_for_remaining_gates':'incomplete',fieldProtocolAccepted:state.channels.chassis.receiptFresh===true,exitCode:0};
writeFileSync(output,JSON.stringify(record,null,2)+'\n');writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/protocol-meta.json',JSON.stringify(protocolMeta));console.log(JSON.stringify(record));
