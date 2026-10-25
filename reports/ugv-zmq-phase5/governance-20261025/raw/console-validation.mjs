import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFile, writeFile, unlink} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {join} from 'node:path';
const root='/mnt/data/ugv-zmq-phase5-governance-20261025';
const smpp='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform';
const node='/home/sz/.nvm/versions/node/v22.23.2/bin/node';
const mode=process.argv[2];
if(!['unit','browser','legacy-browser','lifecycle'].includes(mode)) throw Error('MODE_REQUIRED');
const c=JSON.parse(await readFile(join(root,'fixture-config.json'),'utf8'));
const mqtt=JSON.parse(await readFile(join(root,'mqtt-ownership.json'),'utf8'));
if(mqtt.owner!=='zmq-phase5-governance'||mqtt.host!=='127.0.0.1'||!Number.isInteger(mqtt.port))throw Error('OWNED_MQTT_REQUIRED');
if(c.owner!=='zmq-phase5-governance'||new URL(c.databaseUrl).hostname!=='127.0.0.1'||new URL(c.databaseUrl).pathname!=='/zmq_governance')throw Error('OWNED_FIXTURE_REQUIRED');
if(['browser','legacy-browser'].includes(mode)){
 const guard=createServer();
 await new Promise((resolve,reject)=>{guard.once('error',reject);guard.listen(mode==='browser'?19106:19105,'127.0.0.1',resolve)});
 await new Promise(resolve=>guard.close(resolve));
}
const require=createRequire(join(smpp,'package.json')), {Pool}=require('pg');
const admin=new Pool({connectionString:c.databaseUrl});
const id=randomUUID().replaceAll('-',''), database='zmqgov_console_'+id;
const file=join(root,'console-'+mode+'-'+id+'.json');
let created=false,exitCode=1; const cleanupErrors=[];
try {
 await admin.query('CREATE DATABASE "'+database+'" TEMPLATE template0');created=true;
 const url=new URL(c.databaseUrl);url.pathname='/'+database;
 await writeFile(file,JSON.stringify({owner:'inspection-area-v1',databaseUrl:url.toString(),brokerUrl:'mqtt://127.0.0.1:'+mqtt.port}),{mode:0o600,flag:'wx'});
 const args=mode==='lifecycle'?[join(smpp,'node_modules/vitest/vitest.mjs'),'run','tests/integration/task-lifecycle-postgres.test.ts']:mode==='unit'?[join(smpp,'node_modules/vitest/vitest.mjs'),'run','--config','vitest.config.ts']:[join(smpp,'apps/ugv-control-console/node_modules/@playwright/test/cli.js'),'test',...(mode==='browser'?['--config','playwright.zmq.config.ts']:[])];
 const child=spawn(node,args,{cwd:mode==='lifecycle'?smpp:join(smpp,'apps/ugv-control-console'),env:{...process.env,TEST_DATABASE_URL:url.toString(),SMPP_INSPECTION_TEST_CONFIG_FILE:file,SMPP_ZMQ_TEST_CONFIG_FILE:file,SMPP_ZMQ_BROWSER_RAW_FILE:join(root,'console-'+id+'.ndjson'),SMPP_ZMQ_BROWSER_EVIDENCE_FILE:join(root,'console-'+id+'-evidence.json'),SMPP_ZMQ_BROWSER_REPORT_FILE:join(root,'console-'+id+'-report.json')},stdio:'inherit'});
 exitCode=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1))});
} finally {
 if(created){
  try{await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()',[database]);await admin.query('DROP DATABASE "'+database+'"');}catch(e){cleanupErrors.push(String(e))}
 }
 await admin.end();
 try{await unlink(file)}catch(e){if(e.code!=='ENOENT')cleanupErrors.push(String(e))}
 const report={schemaVersion:'ugv.zmq-console-isolated/1',mode,id,database,exitCode,cleanupErrors};
 await writeFile(join(root,'console-'+mode+'-'+id+'-cleanup.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 console.log(JSON.stringify(report));
}
process.exitCode=cleanupErrors.length?1:exitCode;
