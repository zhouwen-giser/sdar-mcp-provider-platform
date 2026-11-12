import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const root='/home/sz/.codex/worktrees/trajectory-history-authority/sdar-mcp-provider-platform';
const require=createRequire(root+'/apps/ugv-control-console/package.json');
const {chromium}=require('@playwright/test');
const login=readFileSync('/home/sz/.smpp-debug/ugv-control-console/operator-login.txt','utf8');
function credential(label){const line=login.split('\n').find(s=>s.includes(label));if(!line)throw Error('CREDENTIAL_LABEL_MISSING');const value=line.split(/[:：]/).slice(1).join(':').trim().replace(/^`|`$/g,'');if(!value)throw Error('CREDENTIAL_MISSING');return value;}
const browser=await chromium.launch({headless:true,executablePath:'/home/sz/.cache/ms-playwright/chromium-1194/chrome-linux/chrome',args:['--no-sandbox','--disable-dev-shm-usage','--no-proxy-server']});
const context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}}),page=await context.newPage();
const errors=[];page.on('pageerror',()=>errors.push('PAGE_ERROR'));
try{
 await page.goto('http://127.0.0.1:19111/');
 await page.getByLabel('账号',{exact:true}).fill(credential('账号'));
 await page.getByLabel('密码',{exact:true}).fill(credential('初始密码'));
 await page.getByRole('button',{name:'进入控制台 →'}).click();
 await page.getByLabel('观测归档与准入').getByText('正常写入',{exact:false}).waitFor({timeout:30000});
 const device=await (await context.request.get('http://127.0.0.1:19111/api/device')).json();
 await page.getByRole('button',{name:/^查看原图 · eo · /}).first().click();
 const img=page.getByRole('img',{name:/^光电原图 /});await img.waitFor({timeout:15000});
 await page.getByText('曝光 UTC：未知（上游未提供）').waitFor();
 const dims=await img.evaluate(i=>({width:i.naturalWidth,height:i.naturalHeight,complete:i.complete}));
 if(dims.width!==640||dims.height!==480||!dims.complete)throw Error('ORIGINAL_IMAGE_DIMENSION_INVALID');
 const dlPromise=page.waitForEvent('download');await page.getByRole('link',{name:'下载本次原图'}).click();const dl=await dlPromise;
 if(await dl.failure())throw Error('DOWNLOAD_FAILED');
 const stream=await dl.createReadStream();const hash=createHash('sha256');let count=0;for await(const b of stream){hash.update(b);count+=b.length;}
 const tasks=await (await context.request.get('http://127.0.0.1:19111/api/tasks')).json();
 let report={status:'not_attempted',reason:'NO_VISIBLE_HISTORY'};
 for(const task of tasks.slice(0,20)){
  const response=await context.request.get('http://127.0.0.1:19111/api/tasks/'+encodeURIComponent(task.taskId)+'/report',{timeout:20000});
  if(response.ok()){const bytes=await response.body();const payload=JSON.parse(bytes);report={status:'passed',taskId:task.taskId,schemaVersion:payload.schemaVersion,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};break;}
  report={status:'not_accepted',taskId:task.taskId,http:response.status(),reason:(await response.json()).reasonCode};
 }
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 const mobile=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));
 const result={sourceCommit:'a22b74f6bede44fb1b671433c0c1c8d135be2bc6',verifiedAt:new Date().toISOString(),url:'http://127.0.0.1:19111/',httpLogin:true,archiveHealthy:true,profile:device.nativeCatalogProfile??device.catalogProfile,originalImage:dims,download:{bytes:count,sha256:hash.digest('hex'),filename:dl.suggestedFilename()},visibleHistoryTasks:tasks.length,historicalReport:report,mobileNoHorizontalOverflow:mobile.scrollWidth<=mobile.width,pageErrors:errors.length,physicalControlActions:0,exitCode:0};
 if(!result.mobileNoHorizontalOverflow||errors.length)throw Error('CONSOLE_RENDER_INVALID');
 writeFileSync(root+'/reports/ugv-zmq-v15/evidence/attempt-2/candidate-console-live.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{await context.close();await browser.close();}
