import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Mcp,toolContent,protocolMeta} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/server/mcp.ts';
import {nativeCatalogReason} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/apps/ugv-control-console/shared/zmq-native.ts';
const output='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/reports/ugv-zmq-v151/evidence/candidate-live.json';
const mcp=new Mcp('http://127.0.0.1:19110/mcp',{'x-sdar-execution-mode':'live'}),resourceId='vehicle:ugv';
const list=await mcp.rpc('tools/list'),tools=list.tools as Parameters<typeof nativeCatalogReason>[0];
if(tools.length!==15||nativeCatalogReason(tools,resourceId)!==null)throw Error('CANDIDATE_CATALOG_INVALID');
const caps=toolContent(await mcp.tool('vehicle_get_capabilities',{resourceId}));
if(caps.catalogProfile!=='zmq_v1_5_1_readonly_15')throw Error('CANDIDATE_V151_PROFILE_REQUIRED');
if((caps.chassisWire as any)?.publicationFraming!=='prefix_business_length_crc')throw Error('EXPLICIT_RECEIVE_VARIANT_REQUIRED');
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
if(position){try{const result=toolContent(await mcp.tool('vehicle_zmq_plan_route',{resourceId,start:{longitude:position.longitude,latitude:position.latitude},waypoints:JSON.parse(readFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/interop-20261112/planner-direct.json','utf8')).input.waypoints,density:'adaptive'}));if(result.schemaVersion!=='ugv.zmq-route-preview/2'||result.correlation!=='request_id_epoch_context_and_geometry'||result.adoption!=='preview_only')throw Error('V2_PREVIEW_CONTRACT_INVALID');writeFileSync('/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/reports/ugv-zmq-v151/evidence/candidate-route-preview.json',JSON.stringify(result,null,2)+'\n');planner={status:'passed',context:result.context,planningRequestId:result.planningRequestId,transform:result.transform,schemaVersion:result.schemaVersion,adoption:result.adoption,correlation:result.correlation,points:(result.waypoints as unknown[]).length,sourceMessageSha256:result.sourceMessageSha256};}catch(error){planner={status:'not_accepted',reason:error instanceof Error?error.message:'UNKNOWN'};}}
const record={sourceCommit:'ada745829c635b9bb56d6017c2c2faf7f31e544e',verifiedAt:new Date().toISOString(),runtime:'http://127.0.0.1:19110/mcp',profile:caps.catalogProfile,tools:tools.length,readOnly:caps.controlAvailable===false,anonymous:true,invalidJwtRejected,identityOverrideIgnored:true,archive:state.archive,archiveGaps:state.archiveGaps,channels:state.channels,sessionId:state.sessionId,partitionHash:state.partitionHash,protocols:[...new Set(observations.map((o)=>o.component+'@'+o.observation.protocolVersion))],frame:{metadata:first.metadata,sha256:first.sha256,byteLength:total,blocks,reference:first.reference,overlays:(first.overlays as unknown[]).length,diagnostics:first.diagnostics,rawImagePersisted:false},planner,physicalControlActions:0,receiveFraming:caps.chassisWire,standard21Conformance:false,acceptanceScope:'readonly_catalog_chassis_compat_eo_effect_frame_dashboard_v2',overallFieldAcceptance:state.channels.chassis.receiptFresh?'ready_for_remaining_gates':'incomplete',fieldProtocolAccepted:state.channels.chassis.receiptFresh===true,exitCode:0};
if(planner.status!=='passed'||!state.channels.chassis.receiptFresh){record.exitCode=2;process.exitCode=2;}
writeFileSync(output,JSON.stringify(record,null,2)+'\n');writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/protocol-meta.json',JSON.stringify(protocolMeta));console.log(JSON.stringify(record));
