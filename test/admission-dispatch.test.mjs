import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture,token,origin} from './fixtures/admission-fixture.mjs';
import {createAdmissionAssistantAdapter} from '../experimental/runtime-control/src/admission-dispatch.mjs';
import {createLocalAdmissionHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createDispatcher} from '../experimental/runtime-control/src/dispatcher.mjs';
import {InvocationIncompleteError,withInvocationDiagnostic} from '../experimental/runtime-control/src/adapters.mjs';
import {isDurableIncompleteFailureReceipt} from '../experimental/runtime-control/src/relay-store.mjs';
import {prepareAdmissionRuntime} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {createAdmissionHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';
import {createCatalogueLoader} from '../experimental/runtime-control/src/admission-catalogue.mjs';

async function pipeline(t,{actual=false,response='stop',appendFailure=false,slots=2}={}){
 const f=await fixture(t,{slots}),spent=new Set();let calls=0,costStopped=false,accepting=true;
 const markers=path.join(f.dir,'markers');fs.mkdirSync(markers,{mode:0o700});fs.chmodSync(markers,0o700);
 const fetchImpl=async()=>{calls++;if(response==='network')throw Error('PRIVATE_NETWORK_SENTINEL');return new Response(JSON.stringify({id:'synthetic-result',model:'openai/gpt-oss-20b',choices:[{finish_reason:response,message:{role:'assistant',content:'Synthetic saved result.'}}]}));};
 const adapterFactory=options=>{let attempted=false,pending=null;return {kind:'groq-durable-one-shot',assistantId:'groq:openai/gpt-oss-20b',canServeResults:true,get ready(){return !attempted&&!spent.has(options.gate.grantId)&&!costStopped;},acceptsWorkScope:()=>true,async answer(input){
  if(attempted||spent.has(options.gate.grantId)||costStopped)throw Object.assign(Error('groq_free_scope_unavailable'),{code:'groq_free_scope_unavailable'});attempted=true;spent.add(options.gate.grantId);calls++;
  if(response==='network'){costStopped=true;throw withInvocationDiagnostic(Object.assign(Error('PRIVATE_NETWORK_SENTINEL'),{code:'groq_outcome_uncertain'}),{phase:'network',code:'network_failed'});}
  if(response==='length'){costStopped=true;pending=withInvocationDiagnostic(new InvocationIncompleteError(),{phase:'finish_reason',code:'finish_reason_rejected',httpStatus:200,finishReason:'length'});throw pending;}
  return {owner:input.owner,task:input.task,requestId:input.requestId,attempt:input.attempt,eventId:'resp:'+input.requestId,kind:'answer',outcomeKind:'information',body:'Synthetic saved result.',statusChange:null};
 },async finalizeIncomplete(input){assert.equal(input.error,pending);assert.equal(isDurableIncompleteFailureReceipt(input.failureReceipt,input.requestId),true);costStopped=false;return true;}};};
 const router=createAdmissionAssistantAdapter({activationEnabled:true,loadPolicy:()=>f.policy,binding:f.binding,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',markerDirectory:markers,now:f.now,fetchImpl,testOnly:{synthetic:true,...(actual?{}:{markerParentReady:()=>true,markerSpent:id=>spent.has(id),adapterFactory})}});
 router.attachStore(f.store,{accepting:()=>accepting});
 const handler=createLocalAdmissionHandler({mode:'synthetic-integration-only',auth:{authenticate:async value=>value===token},store:f.store,loadPolicy:()=>f.policy,binding:f.binding,origins:[origin],now:f.now,currentAvailability:router.availability});
 const request=(url,options={})=>f.request(url,{...options,adapter:handler});
 const register=async(index=0)=>{const selected={entryId:f.entry.entryId,slotId:f.entry.slots[index].slotId},proof=await request('/request-approvals',{body:selected});assert.equal(proof.status,200,JSON.stringify(proof.body));if(proof.body.existing)return proof;return request('/requests',{body:{...selected,nonce:proof.body.nonce,approvedInputSha256:f.entry.inputSha256,approve:true}});};
 const store={...f.store.relay,claimNext:input=>router.claimNext(input)},board={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:appendFailure?async()=>{throw Error('PRIVATE_COMMIT_SENTINEL');}:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 const dispatcher=createDispatcher({store,boardAdapter:board,assistantAdapter:router,enabled:true,production:false,now:f.now,workerId:'admission-test',claimTtlMs:60000});
 return {f,router,register,dispatcher,request,markers,get calls(){return calls;},setAccepting:value=>accepting=value};
}
test('disabled factories neither open files nor activate routes',async()=>{
 assert.equal(prepareAdmissionRuntime({activationEnabled:false,config:null}),null);assert.equal(createAdmissionStore({activationEnabled:false,dbPath:'/DO_NOT_OPEN'}),null);assert.equal(createCatalogueLoader({activationEnabled:false,file:'/DO_NOT_OPEN'}),null);
 let touched=false;const handler=createAdmissionHandler({activationEnabled:false,loadPolicy:()=>{touched=true;throw Error('must_not_read');}});assert.equal(await handler({url:'/requests',method:'POST'},{}),false);assert.equal(touched,false);
 const adapter=createAdmissionAssistantAdapter();assert.equal(adapter.ready,false);assert.equal(adapter.canServeResults,false);assert.equal(adapter.claimNext({}),null);
});

test('an empty enrolled catalogue grants zero calls and reports no available work',async t=>{
 const p=await pipeline(t);p.f.catalogue.entries=[];assert.equal(p.router.ready,false);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,0);
 const catalogue=await p.request('/request-catalogue');assert.equal(catalogue.status,200);assert.equal(catalogue.body.entries.length,0);assert.equal(catalogue.body.policy.totalSlots,0);
 assert.equal((await p.request('/request-approvals',{body:{entryId:'literal',slotId:'slot-0'}})).status,400);
});
test('approved request flows from atomic admission to one dynamic dispatch and durable result without selector restart',async t=>{
 const p=await pipeline(t);assert.equal(p.router.ready,true);const registration=await p.register();assert.equal(registration.status,201);const result=await p.dispatcher.runOnce();assert.equal(result.status,'completed');assert.equal(p.calls,1);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,1);
 const saved=await p.request('/requests/'+registration.body.ref);assert.equal(saved.status,200);assert.equal(saved.body.state,'completed');assert.equal(saved.body.result.body,'Synthetic saved result.');assert.equal(saved.body.resultAvailable,true);assert.equal(JSON.stringify(saved.body).includes('grantId'),false);
 const duplicate=await p.register();assert.equal(duplicate.body.existing,true);assert.equal(p.calls,1);
 assert.equal((await p.register(1)).status,201);assert.equal((await p.dispatcher.runOnce()).status,'completed');assert.equal(p.calls,2);assert.equal(p.router.ready,false);assert.equal(p.router.canServeResults,true);
});
test('a queue row without consumed owner approval proof is not dispatch authority',async t=>{
 const p=await pipeline(t),selected={entryId:p.f.entry.entryId,slotId:p.f.entry.slots[0].slotId};const {planFiniteAdmission}=await import('../experimental/runtime-control/src/admission-plan.mjs');
 const plan=await planFiniteAdmission({mode:'synthetic-review-only',catalogue:p.f.catalogue,costEnrollment:p.f.enrollment,actor:{ownerId:p.f.catalogue.ownerId,approvedInputSha256:p.f.entry.inputSha256,approvedAt:p.f.now(),approvalRef:'SYNTHETIC_UNCONSUMED'},selection:selected,at:p.f.now()});await p.f.store.relay.accept(plan.intent.payload);
 assert.equal(p.router.acceptsWorkScope(plan.intent.payload),false);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,0);assert.equal(p.f.store.get(plan.intent.payload.eventId).state,'queued');
});
test('concurrent dispatcher attempts and repeated clicks never duplicate an inference',async t=>{const p=await pipeline(t);await p.register();const results=await Promise.all([p.dispatcher.runOnce(),p.dispatcher.runOnce(),p.dispatcher.runOnce()]);assert.equal(results.filter(r=>r.status==='completed').length,1);assert.equal(p.calls,1);await p.register();assert.equal(p.calls,1);});

test('restart recovers a durably saved reply when every slot is spent, with zero provider calls',async t=>{
 const p=await pipeline(t,{slots:1}),registration=await p.register(),ref=registration.body.ref;
 const claim=p.router.claimNext({workerId:'before-crash',claimTtlMs:1000}),input={requestId:ref,workerId:'before-crash',attempt:claim.attempt};
 p.f.store.relay.startInvocation(input);
 p.f.store.relay.appendReply({...input,owner:p.f.catalogue.ownerId,task:p.f.catalogue.taskId,eventId:'resp:'+ref,kind:'answer',outcomeKind:'information',body:'SAVED_BEFORE_CRASH',statusChange:null});
 p.f.tick(1001);p.f.restart();
 const next=createAdmissionAssistantAdapter({activationEnabled:true,loadPolicy:()=>p.f.policy,binding:p.f.binding,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',markerDirectory:p.markers,now:p.f.now,testOnly:{synthetic:true,markerParentReady:()=>true,markerSpent:()=>true,adapterFactory:()=>{throw Error('must_not_create_provider_adapter');}}});
 next.attachStore(p.f.store);assert.equal(next.ready,false);
 const store={...p.f.store.relay,claimNext:value=>next.claimNext(value)},board={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:()=>{throw Error('must_not_append_again');},getReplyByRequestId:store.getReplyByRequestId};
 const restarted=createDispatcher({store,boardAdapter:board,assistantAdapter:next,enabled:true,now:p.f.now,workerId:'after-crash',claimTtlMs:60000});
 assert.equal((await restarted.runOnce()).status,'reconciled');assert.equal(p.f.store.get(ref).state,'completed');assert.equal(p.calls,0);assert.equal(JSON.parse(p.f.store.get(ref).result_json).body,'SAVED_BEFORE_CRASH');assert.equal((await restarted.runOnce()).status,'idle');
});

test('expired unknown invocation retains sanitized diagnostics and never becomes a fresh dispatch',async t=>{
 const p=await pipeline(t),r=await p.register(),ref=r.body.ref,claim=p.router.claimNext({workerId:'before-crash',claimTtlMs:1000}),input={requestId:ref,workerId:'before-crash',attempt:claim.attempt};
 p.f.store.relay.startInvocation(input);p.f.store.relay.recordInvocationDiagnostic({...input,diagnostic:{phase:'parse',code:'json_invalid',httpStatus:200,raw:'PRIVATE_RAW_BODY',headers:{secret:'PRIVATE_HEADER'}}});
 p.f.tick(1001);assert.equal((await p.dispatcher.runOnce()).status,'idle');const row=p.f.store.get(ref);assert.equal(row.state,'uncertain');assert.match(row.last_error,/httpStatus/);assert.equal(row.last_error.includes('PRIVATE_'),false);assert.equal(p.calls,0);assert.equal(p.router.ready,false);
});

test('changed persisted owner, task, grant, expiry or payload identity cannot invoke',async t=>{
 for(const [column,value] of [['owner','other-owner'],['task','other-task'],['message_id','other-request'],['grant_id','other-grant'],['grant_expires',1],['payload_hash','c'.repeat(64)]]){
  const p=await pipeline(t),r=await p.register(),db=new DatabaseSync(p.f.dbPath);try{db.prepare('UPDATE relay_jobs SET '+column+'=? WHERE event_id=?').run(value,r.body.ref);}finally{db.close();}
  assert.equal(p.router.ready,false,column);assert.equal((await p.dispatcher.runOnce()).status,'idle',column);assert.equal(p.calls,0,column);
 }
});
test('unknown transport outcome remains uncertain/spent and stops fresh work without replay',async t=>{
 const p=await pipeline(t,{response:'network'});const r=await p.register();const result=await p.dispatcher.runOnce();assert.equal(result.status,'uncertain');assert.equal(p.calls,1);assert.equal(p.router.ready,false);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,1);assert.equal(p.f.store.get(r.body.ref).state,'uncertain');
 const next=await p.request('/request-approvals',{body:{entryId:p.f.entry.entryId,slotId:p.f.entry.slots[1].slotId}});assert.equal(next.status,503);assert.equal(JSON.stringify(p.f.store.get(r.body.ref)).includes('PRIVATE_'),false);
});
test('known incomplete response settles only with durable failure receipt; same slot remains spent',async t=>{
 const p=await pipeline(t,{response:'length'});const first=await p.register();assert.equal((await p.dispatcher.runOnce()).status,'failed');assert.equal(p.f.store.get(first.body.ref).state,'failed');assert.equal(p.calls,1);assert.equal(p.router.ready,true);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,1);assert.equal((await p.register()).body.existing,true);
});
test('failed result persistence does not authorize another inference or unrelated fresh admission',async t=>{
 const p=await pipeline(t,{appendFailure:true});await p.register();assert.equal((await p.dispatcher.runOnce()).status,'uncertain');assert.equal(p.calls,1);assert.equal(p.router.ready,false);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,1);
});

function restartRouter(p){
 const router=createAdmissionAssistantAdapter({activationEnabled:true,loadPolicy:()=>p.f.policy,binding:p.f.binding,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',markerDirectory:p.markers,now:p.f.now,testOnly:{synthetic:true,markerParentReady:()=>true,markerSpent:()=>false,adapterFactory:()=>({kind:'groq-durable-one-shot',assistantId:'groq:openai/gpt-oss-20b',canServeResults:true,ready:true,answer(){throw Error('MUST_NOT_INVOKE');}})}});
 router.attachStore(p.f.store);return router;
}

test('reply-persistence uncertainty survives catalogue removal, expiry cleanup and restart under same enrollment',async t=>{
 const p=await pipeline(t,{appendFailure:true}),first=await p.register(),ref=first.body.ref;assert.equal((await p.dispatcher.runOnce()).status,'uncertain');assert.equal(p.calls,1);
 p.f.entry.slots=p.f.entry.slots.slice(1);assert.equal(p.router.availability().code,'pending_uncertainty');assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.catalogue.enrollmentId),true);assert.equal(p.f.store.hasEnrollmentUncertainty('f'.repeat(64)),true);
 p.f.tick(3600001);p.f.catalogue.notBefore=p.f.now()-1000;p.f.catalogue.expiresAt=p.f.now()+3600000;p.f.restart();const next=restartRouter(p);assert.equal(next.availability().code,'pending_uncertainty');
 const handler=createLocalAdmissionHandler({mode:'synthetic-integration-only',store:p.f.store,auth:{authenticate:async value=>value===token},loadPolicy:()=>p.f.policy,binding:p.f.binding,origins:[origin],now:p.f.now,currentAvailability:next.availability});
 const denied=await p.f.request('/request-approvals',{body:{entryId:p.f.entry.entryId,slotId:p.f.entry.slots[0].slotId},adapter:handler});assert.equal(denied.status,503);
 assert.equal(p.f.store.get(ref).state,'uncertain');assert.equal(p.f.store.get(p.f.entry.slots[0].eventId),null);assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.catalogue.enrollmentId),true);assert.equal(p.calls,1);
});

test('restart before lease expiry blocks a different already-approved slot while original invocation is unresolved',async t=>{
 const p=await pipeline(t);await p.register(0);await p.register(1);const claim=p.router.claimNext({workerId:'crashed-worker',claimTtlMs:60000});p.f.store.relay.startInvocation({requestId:claim.request_id,attempt:claim.attempt,workerId:'crashed-worker'});
 p.f.restart();const next=restartRouter(p);assert.equal(p.f.store.get(claim.request_id).state,'invoking');assert.equal(next.availability().code,'pending_uncertainty');assert.equal(next.claimNext({workerId:'restart',claimTtlMs:60000}),null);assert.equal(p.calls,0);
 p.f.tick(60001);assert.equal(next.claimNext({workerId:'restart',claimTtlMs:60000}),null);assert.equal(p.f.store.get(claim.request_id).state,'uncertain');assert.equal(next.availability().code,'pending_uncertainty');assert.equal(p.calls,0);
});

test('known durable incomplete output does not become an enrollment-wide stop after catalogue replacement',async t=>{
 const p=await pipeline(t,{response:'length'}),first=await p.register();assert.equal((await p.dispatcher.runOnce()).status,'failed');assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.catalogue.enrollmentId),false);
 p.f.entry.slots=p.f.entry.slots.slice(1);assert.equal(p.router.ready,true);assert.equal((await p.register()).status,201);assert.equal((await p.dispatcher.runOnce()).status,'failed');assert.equal(p.calls,2);assert.equal(p.f.store.get(first.body.ref).state,'failed');
});
test('drain, changed enrollment/configuration and expired catalogue stop dynamic dispatch before I/O',async t=>{
 for(const mode of ['drain','key','project','configuration','expiry']){const p=await pipeline(t);await p.register();if(mode==='drain')p.setAccepting(false);if(mode==='key')p.f.enrollment.keySha256='c'.repeat(64);if(mode==='project')p.f.enrollment.projectId='other';if(mode==='configuration')p.f.policy.configurationSha256='c'.repeat(64);if(mode==='expiry')p.f.tick(3600000);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,0);}
});
for(const response of ['stop','length','network'])test('actual durable Groq adapter with synthetic transport: '+response,{skip:process.platform!=='linux'?'Requires actual Linux one-shot marker/parent semantics.':false},async t=>{
 const p=await pipeline(t,{actual:true,response});const row=await p.register();assert.equal(row.status,201);const result=await p.dispatcher.runOnce();assert.equal(result.status,response==='stop'?'completed':response==='length'?'failed':'uncertain');assert.equal(p.calls,1);
 const marker=path.join(p.markers,'groq-once-'+p.f.entry.slots[0].grantId+'.consumed');assert.equal(fs.existsSync(marker),true);assert.equal((await p.dispatcher.runOnce()).status,'idle');assert.equal(p.calls,1);
 const latch=path.join(p.markers,'.groq-cost-'+p.f.catalogue.enrollmentId+'.pending');assert.equal(fs.existsSync(latch),response==='network');
});
