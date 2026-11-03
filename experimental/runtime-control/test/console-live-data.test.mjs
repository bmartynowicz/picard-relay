import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {createRelayStore} from '../src/relay-store.mjs';
import {startOracleService,createOwnerAuth,createBootstrapState,CONSOLE_HTML} from '../src/oracle-service.mjs';
import {canonical,digest,payloadHash} from '../src/protocol.mjs';

const assistantId='groq:openai/gpt-oss-20b',origin='https://relay.example';
const get=(port,url,cookie)=>new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port,path:url,headers:{host:'relay.example',origin,'sec-fetch-site':'same-origin',...(cookie?{cookie}:{})}},res=>{let text='';res.setEncoding('utf8');res.on('data',part=>text+=part);res.on('end',()=>resolve({status:res.statusCode,value:JSON.parse(text)}));});req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('fixture_timeout')));req.end();});
for(const [admissionEnabled,reusableBoardEnabled,expectedScope] of [[true,true,'owner'],[true,false,'task'],[false,true,'task']]){
 test('live console scope '+JSON.stringify({admissionEnabled,reusableBoardEnabled,expectedScope}),{skip:process.platform!=='linux'?'Real owner-auth filesystem qualification runs on Linux':false},async t=>{
  const dir=mkdtempSync(join(tmpdir(),'picard-live-scope-')),authDir=join(dir,'auth'),dbPath=join(dir,'ledger.sqlite');mkdirSync(authDir,{mode:0o700});
  let runtime,calls=0;
  t.after(async()=>{if(runtime)await runtime.shutdown();rmSync(dir,{recursive:true,force:true});});
  const at=Date.now(),code='A'.repeat(43);writeFileSync(join(authDir,'auth-state.json'),JSON.stringify(createBootstrapState({code,createdAt:at,expiresAt:at+60000})),{mode:0o600});
  const auth=createOwnerAuth({stateDir:authDir}),session=await auth.setup({code,password:'Synthetic fixture password'}),cookie='__Host-PicardSession='+session.token;
  const seed=createRelayStore({dbPath}),refs=[];
  try{
   for(const [ownerId,taskId,state] of [['owner','legacy-task','completed'],['owner','new-approved-task','failed'],['other-owner','legacy-task','uncertain']]){
    const requestId='fixture-message-'+refs.length,eventId=await digest(canonical([ownerId,taskId,requestId]));
    const p={v:1,eventId,ownerId,taskId,requestId,grantId:'fixture-grant-'+refs.length,assistantId,grantExpiresAt:at+60000,request:{text:'SYNTHETIC_PRIVATE_PROMPT',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'SYNTHETIC_PRIVATE_TITLE',nextAction:'Review',latestFinding:'Synthetic'}};p.payloadHash=await payloadHash(p);await seed.accept(p);
    const claim=seed.claimNext({workerId:'seed',claimTtlMs:60000}),owned={requestId:eventId,attempt:claim.attempt,workerId:'seed'};
    if(state==='completed'){seed.startInvocation(owned);seed.appendReply({...owned,owner:ownerId,task:taskId,eventId:'resp:'+eventId,kind:'answer',outcomeKind:'information',statusChange:null,body:'SYNTHETIC_PRIVATE_RESULT'});seed.markCompleted(owned);}
    else{if(state==='uncertain')seed.startInvocation(owned);seed.markFailed({...owned,error:'dispatcher_error'});}
    refs.push(eventId);
   }
  }finally{seed.close();}
  const config={dbPath,port:0,ownerId:'owner',allowedTaskId:'legacy-task',assistantId,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890',consoleEnabled:true,consoleAuthDir:authDir,consoleOrigins:[origin],admissionEnabled,admissionReusableBoardEnabled:reusableBoardEnabled};
  runtime=await startOracleService(config,{kind:'offline-console-scope-fixture',assistantId,ready:false,canServeResults:true,answer(){calls++;throw Error('must_not_call');}},{installSignals:false,intervalMs:60000,admissionFactory:({store})=>({html:CONSOLE_HTML,dispatchStore:{...store,claimNext:()=>null},handler:async()=>false,close(){}})});
  const port=runtime.address().port;
  assert.equal((await get(port,'/status')).status,401);assert.equal((await get(port,'/jobs')).status,401);
  const status=await get(port,'/status',cookie),jobs=await get(port,'/jobs',cookie);assert.equal(status.status,200);assert.equal(jobs.status,200);assert.equal(status.value.scope,expectedScope);
  assert.equal(status.value.jobs.completed,1);assert.equal(status.value.jobs.failed,expectedScope==='owner'?1:0);assert.equal(status.value.jobs.uncertain,0);
  assert.deepEqual(jobs.value.rows.map(row=>row.ref).sort(),(expectedScope==='owner'?refs.slice(0,2):refs.slice(0,1)).sort());
  assert.equal((await get(port,'/jobs?ownerId=other-owner',cookie)).status,400);assert.equal((await get(port,'/jobs?taskId=new-approved-task',cookie)).status,400);
  assert.doesNotMatch(JSON.stringify({status:status.value,jobs:jobs.value}),/SYNTHETIC_PRIVATE|other-owner|new-approved-task|legacy-task|fixture-grant/);assert.equal(calls,0);
 });
}
