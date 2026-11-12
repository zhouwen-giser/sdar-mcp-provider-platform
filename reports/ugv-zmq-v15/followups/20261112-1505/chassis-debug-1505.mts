import {readFileSync,writeFileSync} from 'node:fs';
import pg from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/node_modules/pg/lib/index.js';
const {Pool}=pg;
import {decodeChassisFrame as versioned} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/vehicle-zmq-contract/src/chassis-versioned.ts';
import {crc16CcittFalse,decodeChassisFrame as legacy} from '/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform/packages/vehicle-zmq-contract/src/chassis.ts';
const c=JSON.parse(readFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/candidate/provider.json','utf8'));
const p=new Pool({connectionString:c.observationDatabaseUrl,max:1,statement_timeout:3000});
try{const r=await p.query("SELECT ordinal,payload FROM ugv_zmq_observation.archive_entry WHERE session_id=$1 AND payload->>'component'='chassis' ORDER BY ordinal DESC LIMIT 2000",['57b50e55-6d20-46f9-82af-00f6bd70807b']);
const byMessage=new Map(); for(const row of r.rows){const b=Buffer.from(row.payload.frames[0].base64,'base64');const h=b.indexOf(58)+1;const id=b.readUInt32LE(h);if(!byMessage.has(id))byMessage.set(id,row);}
const rows=[...byMessage.values()].map(({ordinal,payload})=>{const b=Buffer.from(payload.frames[0].base64,'base64'),sep=b.indexOf(58),h=sep+1,wire=b.subarray(h+24),head=b.subarray(h,h+24);let error='',convertedError='';try{versioned(b,{protocolVersion:'2.1'});}catch(e){error=String(e);}
const prefix=Buffer.from(head),body=wire.subarray(4);prefix.writeUInt16LE(body.length,20);prefix.writeUInt16LE(crc16CcittFalse(body),22);try{legacy(Buffer.concat([b.subarray(0,h),prefix,body]));}catch(e){convertedError=String(e);}
return {ordinal,validationCode:payload.validationCode,frameCount:payload.frameCount,bytes:b.length,topic:b.subarray(0,sep).toString(),messageId:head.readUInt32LE(0),declared:head.readUInt16LE(20),wireBytes:wire.length,businessPrefix:wire.readUInt32LE(0),crcValid:crc16CcittFalse(wire)===head.readUInt16LE(22),bodyCrcValid:crc16CcittFalse(body)===head.readUInt16LE(22),declaredCrc:head.readUInt16LE(22),frameBase64:b.toString('base64'),headHex:b.subarray(0,h+36).toString('hex'),error,convertedError};});
writeFileSync('/home/sz/.smpp-debug/zmq-v15-20261112/chassis-debug-1505.json',JSON.stringify(rows,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(rows.map(({frameBase64,...x})=>x)));}finally{await p.end();}
