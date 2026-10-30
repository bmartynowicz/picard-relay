import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createReceiver,healthDiagnostics} from '../experimental/runtime-control/src/receiver.mjs';
import {createRelayStore} from '../experimental/runtime-control/src/relay-store.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../experimental/runtime-control/src/protocol.mjs';
import {startOracleService} from '../experimental/runtime-control/src/oracle-service.mjs';
import {createFixtureTaskExecutor} from '../experimental/runtime-control/src/adapters.mjs';
const config={ownerId:'OFFLINE_OWNER',assistantId:'groq:openai/gpt-oss-20b',allowedTaskId:'OFFLINE_TASK',keyId:'fixture',secret:'OFFLINE_TEST_SECRET_000000000000000000000000'};
const health={serviceReady:true,resultRecoveryReady:true,updateReady:true,releaseHash:'b'.repeat(64),pid:123,privatePath:'PRIVATE_SENTINEL',owner:'PRIVATE_SENTINEL'};
async function work(ownerId,taskId,requestId){
 const at=Date.now(),p={v:1,eventId:await digest(canonical([ownerId,taskId,requestId])),ownerId,taskId,requestId,grantId:'OFFLINE_GRANT',assistantId:config.assistantId,grantExpiresAt:at+60000,request:{text:'Reply Hello World',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Relay Hello World verification',nextAction:'',latestFinding:''}};
 p.payloadHash=await payloadHash(p);return p;
}
async function readHealth(store,scope,runtime=health){
 const receiver=createReceiver({store,config:scope,assistantAdapter:{ready:false,assistantId:scope.assistantId},runtimeHealth:()=>runtime});
 const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'health',ownerId:scope.ownerId},scope),response=await receiver(signed.request);
 assert.equal(response.status,200);return (await verifyResponse(response,signed.nonce,scope)).diagnostics;
}
function completeOnlyFixture(store){
 const workerId='diagnostic-local-fixture',claim=store.claimNext({workerId,claimTtlMs:60000}),i={requestId:claim.request_id,attempt:claim.attempt,workerId};
 store.startInvocation(i);
 store.appendReply({...i,owner:claim.owner,task:claim.task,eventId:'resp:'+claim.request_id,kind:'answer',outcomeKind:'information',body:'OFFLINE_OTHER_SCOPE_RESULT',statusChange:null});
 store.markCompleted(i);
}
test('aggregate snapshot drops private fields and distinguishes service, provider and updater',()=>{
 const h=healthDiagnostics({rows:[{state:'completed',count:2,body:'PRIVATE_SENTINEL'},{state:'uncertain',count:1}],runtimeHealth:health});
 assert.equal(h.serviceReady,true);assert.equal(h.resultRecoveryReady,true);assert.equal(h.providerReady,false);assert.equal(h.acceptingNewWork,false);assert.equal(h.jobsTotal,3);assert.equal(h.resultsTotal,2);assert.equal(h.release.state,'identified');assert.deepEqual(h.updater,{state:'unknown'});assert.equal(JSON.stringify(h).includes('PRIVATE_SENTINEL'),false);assert.equal(h.capabilities.productionTaskExecution,false);
});
test('malformed, duplicate, negative, over-limit and unknown state counts become unknown',()=>{
 for(const rows of [null,{},[{state:'private-task',count:1}],[{state:'queued',count:-1}],[{state:'queued',count:1.5}],[{state:'queued',count:10001}],[{state:'queued',count:9000},{state:'completed',count:1001}],[{state:'queued',count:1},{state:'queued',count:1}]]){
  const h=healthDiagnostics({rows});assert.equal(h.jobsTotal,null);assert.equal(h.resultsTotal,null);assert.equal(h.ledgerStateCounts,null);
 }
 assert.equal(healthDiagnostics({runtimeHealth:{...health,releaseHash:'<script>private</script>'}}).release.hash,null);
 assert.equal(healthDiagnostics({runtimeHealth:{...health,updateReady:false}}).release.state,'unknown');
});
test('signed owner-scoped health returns only diagnostics without consuming work',async()=>{
 const store=createRelayStore({dbPath:':memory:'});let calls=0;
 try{
  const adapter={ready:false,canServeResults:true,assistantId:config.assistantId,kind:'groq-free-only-one-shot',answer:()=>{calls++;throw Error('must not invoke');}};
  const receiver=createReceiver({store,config,assistantAdapter:adapter,runtimeHealth:()=>health});
  const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'health',ownerId:config.ownerId},config);
  const response=await receiver(signed.request);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const p=await verifyResponse(response,signed.nonce,config);assert.equal(p.ready,false);assert.equal(p.diagnostics.serviceReady,true);assert.equal(p.diagnostics.resultRecoveryReady,true);assert.equal(p.diagnostics.jobsTotal,0);assert.deepEqual(p.diagnostics.updater,{state:'unknown'});assert.equal(calls,0);assert.deepEqual(store.stats(),[]);
 }finally{store.close();}
});
test('unsigned, wrong-owner, bad-signature, replay and added fields cannot read diagnostics',async()=>{
 const store=createRelayStore({dbPath:':memory:'});const receiver=createReceiver({store,config,assistantAdapter:{ready:false},runtimeHealth:()=>health});
 try{
  const url='https://relay.invalid/bridge/v1',payload={v:1,action:'health',ownerId:config.ownerId};
  for(const [p,credential,status] of [[{...payload,ownerId:'OTHER'},config,403],[payload,{...config,secret:'WRONG_SECRET_000000000000000000000000000'},403],[{...payload,includePrivate:true},config,400]]){
   const s=await signRequest(url,p,credential);const r=await receiver(s.request);assert.equal(r.status,status);assert.equal((await r.text()).includes('diagnostics'),false);
  }
  const unsigned=await receiver(new Request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}));assert.equal(unsigned.status,403);
  const signed=await signRequest(url,payload,config),copy=signed.request.clone();assert.equal((await receiver(signed.request)).status,200);assert.equal((await receiver(copy)).status,409);
  assert.equal((await receiver(new Request('https://relay.invalid/'))).status,404);
  assert.equal((await receiver(new Request('https://relay.invalid/mission-control'))).status,404);
  assert.equal((await receiver(new Request(url))).status,400);
 }finally{store.close();}
});
test('fixture executor startup is denied before database creation or listener',async()=>{
 await assert.rejects(()=>startOracleService({...config,dbPath:'DOES_NOT_EXIST/no-db.sqlite',port:0},createFixtureTaskExecutor(),{installSignals:false}),/production_fixture_executor_forbidden/);
});
test('spoofed fixture readiness and wrong assistant identity never advertise capacity',async()=>{
 const store=createRelayStore({dbPath:':memory:'});
 try{
  for(const patch of [{localTestOnly:true},{kind:'controlled-local-fixture-only'},{assistantId:'other'}]){
   const assistantAdapter={ready:true,assistantId:config.assistantId,kind:'fixture-spoof',...patch};
   const receiver=createReceiver({store,config,assistantAdapter,runtimeHealth:()=>health});
   const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'health',ownerId:config.ownerId},config);
   const response=await receiver(signed.request),p=await verifyResponse(response,signed.nonce,config);
   assert.equal(p.ready,false);assert.equal(p.diagnostics.providerReady,false);assert.equal(p.diagnostics.acceptingNewWork,false);
  }
  for(const assistantAdapter of [{ready:true,assistantId:config.assistantId,localTestOnly:true},{ready:true,assistantId:config.assistantId,kind:'controlled-local-fixture-only'}])await assert.rejects(()=>startOracleService({...config,dbPath:'DOES_NOT_EXIST/no-db.sqlite',port:0},assistantAdapter,{installSignals:false}),/production_fixture_executor_forbidden/);
 }finally{store.close();}
});
test('signed health excludes another owner even when its task matches',async()=>{
 const store=createRelayStore({dbPath:':memory:'});
 try{
  await store.accept(await work('OTHER_OWNER',config.allowedTaskId,'b1'));
  completeOnlyFixture(store);
  await store.accept(await work(config.ownerId,config.allowedTaskId,'a1'));
  await store.accept(await work('OTHER_OWNER',config.allowedTaskId,'b2'));
  const diagnostics=await readHealth(store,config,{...health,ledgerStateCounts:{queued:3},jobsTotal:3,resultsTotal:3});
  assert.equal(diagnostics.jobsTotal,1);assert.equal(diagnostics.ledgerStateCounts.queued,1);assert.equal(diagnostics.resultsTotal,0);
  assert.equal(JSON.stringify(diagnostics).includes('OTHER_OWNER'),false);assert.equal(JSON.stringify(diagnostics).includes(config.ownerId),false);assert.equal(JSON.stringify(diagnostics).includes(config.allowedTaskId),false);
  assert.equal(store.stats().reduce((total,row)=>total+row.count,0),3); // Private control can still observe global counts.
  assert.equal(store.stats().find(row=>row.state==='completed').count,1);
 }finally{store.close();}
});
test('signed health filters the configured task and owner while owner-only scope remains explicit',async()=>{
 const store=createRelayStore({dbPath:':memory:'});
 try{
  await store.accept(await work(config.ownerId,'OTHER_TASK','a0'));
  completeOnlyFixture(store);
  await store.accept(await work(config.ownerId,config.allowedTaskId,'a1'));
  await store.accept(await work(config.ownerId,'OTHER_TASK','a2'));
  await store.accept(await work('OTHER_OWNER',config.allowedTaskId,'b1'));
  store.cancel(config.ownerId,'OTHER_TASK','OFFLINE_GRANT');
  const scoped=await readHealth(store,config);assert.equal(scoped.jobsTotal,1);assert.equal(scoped.ledgerStateCounts.queued,1);assert.equal(scoped.ledgerStateCounts.cancelled,0);assert.equal(scoped.ledgerStateCounts.completed,0);assert.equal(scoped.resultsTotal,0);
  const ownerOnly=await readHealth(store,{...config,assistantId:'offline-fixture',allowedTaskId:''});
  assert.equal(ownerOnly.jobsTotal,3);assert.equal(ownerOnly.ledgerStateCounts.queued,1);assert.equal(ownerOnly.ledgerStateCounts.cancelled,1);assert.equal(ownerOnly.resultsTotal,1);
  assert.equal(store.stats().reduce((total,row)=>total+row.count,0),4);
 }finally{store.close();}
});
test('reopened database and owner/task reconfiguration cannot leak retained scope counts',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'relay-diagnostic-scope-')),dbPath=join(dir,'ledger.sqlite');let store;
 try{
  store=createRelayStore({dbPath});
  for(const [owner,task,id] of [[config.ownerId,config.allowedTaskId,'a1'],[config.ownerId,'NEW_TASK','a2'],['NEW_OWNER','NEW_TASK','b1'],['NEW_OWNER','NEW_TASK','b2']])await store.accept(await work(owner,task,id));
  assert.equal((await readHealth(store,config)).jobsTotal,1);store.close();store=createRelayStore({dbPath});
  for(const [ownerId,allowedTaskId,total] of [[config.ownerId,config.allowedTaskId,1],[config.ownerId,'NEW_TASK',1],['NEW_OWNER','NEW_TASK',2],['NEW_OWNER',config.allowedTaskId,0],['UNUSED_OWNER','NEW_TASK',0]]){
   const d=await readHealth(store,{...config,ownerId,allowedTaskId});assert.equal(d.jobsTotal,total);assert.equal(d.ledgerStateCounts.queued,total);assert.equal(d.resultsTotal,0);
  }
  assert.equal(store.stats()[0].count,4);
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
test('missing or invalid diagnostic scope cannot fall back to global statistics',async()=>{
 const store=createRelayStore({dbPath:':memory:'});let globalReads=0;
 try{
  await store.accept(await work(config.ownerId,config.allowedTaskId,'a1'));
  for(const scope of [undefined,{}, {ownerId:''},{ownerId:null},{ownerId:'x'.repeat(201)},{ownerId:config.ownerId,allowedTaskId:null},{ownerId:config.ownerId,allowedTaskId:7},{ownerId:config.ownerId,allowedTaskId:'x'.repeat(201)}])assert.throws(()=>store.scopedStats(scope),{code:'diagnostic_scope_invalid'});
  assert.deepEqual(store.scopedStats({ownerId:"' OR 1=1 --"}),[]);
  assert.deepEqual(store.scopedStats({ownerId:config.ownerId,allowedTaskId:"' OR 1=1 --"}),[]);
  const privateStats=()=>{globalReads++;return [{state:'queued',count:9999}];};
  for(const scopedStats of [undefined,()=>{throw Error('scope unavailable');}]){
   const d=await readHealth({...store,stats:privateStats,scopedStats},config,{...health,ledgerStateCounts:{queued:9999},jobsTotal:9999});
   assert.equal(d.jobsTotal,null);assert.equal(d.resultsTotal,null);assert.equal(d.ledgerStateCounts,null);assert.equal(d.serviceReady,true);
  }
  const invalidTask=await readHealth({...store,stats:privateStats},{...config,assistantId:'offline-fixture',allowedTaskId:null});
  assert.equal(invalidTask.jobsTotal,null);assert.equal(invalidTask.ledgerStateCounts,null);assert.equal(globalReads,0);
 }finally{store.close();}
});
test('authentication and owner checks run before any scoped statistics read',async()=>{
 const store=createRelayStore({dbPath:':memory:'});let scopedReads=0,globalReads=0;
 try{
  const receiver=createReceiver({store:{...store,scopedStats:()=>{scopedReads++;return [];},stats:()=>{globalReads++;return [];}},config,assistantAdapter:{ready:false}});
  const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'health',ownerId:'OTHER_OWNER'},config);
  assert.equal((await receiver(signed.request)).status,403);
  assert.equal((await receiver(new Request('https://relay.invalid/bridge/v1',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({v:1,action:'health',ownerId:config.ownerId})}))).status,403);
  assert.equal(scopedReads,0);assert.equal(globalReads,0);
 }finally{store.close();}
});
