import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fixture} from './fixtures/admission-fixture.mjs';
import {canonical,payloadHash,signRequest,verifyResponse} from '../experimental/runtime-control/src/protocol.mjs';
import {createAdmissionAssistantAdapter} from '../experimental/runtime-control/src/admission-dispatch.mjs';
import {createReceiver} from '../experimental/runtime-control/src/receiver.mjs';
import {createDispatcher} from '../experimental/runtime-control/src/dispatcher.mjs';
import {admissionConfigurationDigest} from '../experimental/runtime-control/src/admission-runtime.mjs';

async function setup(t,{enabled=true,response='success'}={}){
 const f=await fixture(t),spent=new Set();let calls=0,accepting=true,policyHook=null,policyReads=0;
 const config={keyId:'fixture-key',secret:'SYNTHETIC_SIGNED_BRIDGE_SECRET_NOT_REAL_1234',ownerId:f.catalogue.ownerId,allowedTaskId:f.catalogue.taskId,assistantId:f.catalogue.assistantId};
 const make=()=>{
  const router=createAdmissionAssistantAdapter({activationEnabled:true,signedBridgeEnabled:enabled,bridgeKeyId:config.keyId,loadPolicy:()=>{policyHook?.(++policyReads);return f.policy;},binding:f.binding,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',markerDirectory:f.dir,now:f.now,testOnly:{synthetic:true,markerParentReady:()=>true,markerSpent:id=>spent.has(id),adapterFactory:o=>({kind:'groq-durable-one-shot',assistantId:config.assistantId,ready:!spent.has(o.gate.grantId),canServeResults:true,async answer(input){
   assert.equal(spent.has(o.gate.grantId),false);spent.add(o.gate.grantId);calls++;assert.equal(o.gate.maxCalls,1);assert.equal(o.gate.noPaidFallback,true);assert.equal(o.gate.accountPlan,'Free');
   if(response==='unknown')throw Object.assign(Error('PRIVATE_PROVIDER_SENTINEL'),{code:'groq_outcome_uncertain'});
   return {owner:input.owner,task:input.task,requestId:input.requestId,attempt:input.attempt,eventId:'resp:'+input.requestId,kind:'answer',outcomeKind:'information',body:'Synthetic Board result.',statusChange:null};
  }})}});router.attachStore(f.store,{accepting:()=>accepting});return router;
 };
 let router=make();
 // Explicit fixture wrapper lets the real receiver enforce its production
 // boundary while all provider I/O remains the deterministic counter above.
 const adapter={kind:'groq-finite-admission',assistantId:config.assistantId,localTestOnly:false,get ready(){return router.ready;},get canServeResults(){return router.canServeResults;},acceptsWorkScope:p=>router.acceptsWorkScope(p),registerSignedWork:(p,i)=>router.registerSignedWork(p,i),answer:p=>router.answer(p)};
 const handle=()=>createReceiver({store:f.store.relay,config,assistantAdapter:adapter,canAccept:()=>accepting});
 async function exchange(payload,{badSignature=false,outerOwner=config.ownerId}={}){const signed=await signRequest('https://fixture.invalid/bridge/v1',{v:1,action:'exchange',ownerId:outerOwner,payload},config);if(badSignature)signed.request.headers.set('x-bridge-signature','a'.repeat(64));const r=await handle()(signed.request);return {status:r.status,body:r.headers.has('x-bridge-response')?await verifyResponse(r,signed.nonce,config):await r.json()};}
 async function work(index=0,{life=f.catalogue.maxRequestLifetimeMs,issued=f.now()}={}){const slot=f.entry.slots[index],p={v:1,eventId:slot.eventId,ownerId:config.ownerId,taskId:config.allowedTaskId,requestId:slot.requestId,grantId:slot.grantId,assistantId:config.assistantId,grantExpiresAt:issued+life,request:{text:f.entry.requestText,createdAt:new Date(issued).toISOString(),answerTo:null},context:f.entry.taskContext};p.payloadHash=await payloadHash(p);return p;}
 function dispatcher(){const s={...f.store.relay,claimNext:p=>router.claimNext(p)},board={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:s.getTaskContext,appendReply:response==='save-failure'?()=>{throw Error('PRIVATE_PERSISTENCE_SENTINEL');}:s.appendReply,getReplyByRequestId:s.getReplyByRequestId};return createDispatcher({store:s,boardAdapter:board,assistantAdapter:adapter,enabled:true,production:false,now:f.now,workerId:'signed-bridge-test',claimTtlMs:60000});}
 function sql(fn){const db=new DatabaseSync(f.dbPath);try{return fn(db);}finally{db.close();}}
 return {f,config,exchange,work,dispatcher,sql,handle,get calls(){return calls;},get router(){return router;},setAccepting:v=>accepting=v,onPolicyRead:fn=>{policyReads=0;policyHook=fn;},restart(){f.restart();router=make();}};
}

test('signed-bridge admission is default-off and configuration-bound',async t=>{
 const p=await setup(t,{enabled:false}),w=await p.work();assert.equal((await p.exchange(w)).status,403);assert.equal(p.f.store.get(w.eventId),null);assert.equal(p.calls,0);
 const config={ownerId:'owner',allowedTaskId:'task',assistantId:p.config.assistantId,keyId:'key',consoleOrigins:['https://fixture.invalid']},input={config,enrollmentId:'a'.repeat(64),keySha256:'b'.repeat(64),markerDirectory:'/synthetic'};
 assert.equal(admissionConfigurationDigest(input),admissionConfigurationDigest({...input,config:{...config,admissionSignedBridgeEnabled:false}}));assert.notEqual(admissionConfigurationDigest(input),admissionConfigurationDigest({...input,config:{...config,admissionSignedBridgeEnabled:true}}));
});

test('real signed receiver atomically registers exact work, dispatches once and returns its durable result on duplicate',async t=>{
 const p=await setup(t),w=await p.work(0,{life:599000});const first=await p.exchange(w);assert.equal(first.status,200);assert.equal(first.body.state,'queued');assert.equal(p.calls,0);
 const metadata=p.sql(db=>db.prepare("SELECT nonce FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:signed-bridge:*'").all());assert.equal(metadata.length,1);assert.equal(metadata[0].nonce.includes('PRIVATE_'),false);
 assert.equal(p.sql(db=>db.prepare("SELECT count(*) AS n FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:enrollment:*'").get().n),1);
 assert.equal((await p.dispatcher().runOnce()).status,'completed');assert.equal(p.calls,1);const again=await p.exchange(w);assert.equal(again.body.state,'completed');assert.equal(again.body.result.body,'Synthetic Board result.');assert.equal(p.calls,1);assert.equal(p.f.store.get(w.eventId).attempt,1);
});

test('concurrent signed submissions commit one immutable approval and job',async t=>{
 const p=await setup(t),w=await p.work();const responses=await Promise.all(Array.from({length:6},()=>p.exchange(w)));assert(responses.every(r=>r.status===200));assert.equal(p.sql(db=>db.prepare('SELECT count(*) AS n FROM relay_jobs').get().n),1);assert.equal(p.sql(db=>db.prepare("SELECT count(*) AS n FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:signed-bridge:*'").get().n),1);await p.dispatcher().runOnce();assert.equal(p.calls,1);
});

test('bad signature, outer identity, exact input, context, event, grant and payload hash never register',async t=>{
 for(const change of [null,p=>p.ownerId='other',p=>p.taskId='other',p=>p.grantId='00000000-0000-4000-8000-000000000000',p=>p.eventId='b'.repeat(64),p=>p.request.text+=' PRIVATE_PROMPT_SENTINEL',p=>p.context={...p.context,title:'PRIVATE_CONTEXT_SENTINEL'},p=>p.assistantId='paid:other',p=>p.payloadHash='c'.repeat(64)]){
  const p=await setup(t),w=await p.work();if(change){change(w);if(w.payloadHash!=='c'.repeat(64))w.payloadHash=await payloadHash(w);}const r=await p.exchange(w,{badSignature:change===null});assert.notEqual(r.status,200);assert.equal(p.f.store.relay.stats().length,0);assert.equal(p.calls,0);assert.equal(JSON.stringify(r.body).includes('PRIVATE_'),false);
 }
 const p=await setup(t),w=await p.work();assert.equal((await p.exchange(w,{outerOwner:'other'})).status,403);assert.equal(p.f.store.get(w.eventId),null);
});

test('expiry, future request, enlarged lifetime, revocation, drain and spent grant fail before I/O',async t=>{
 for(const variant of ['expired','future','long','short','revoked','drained','elsewhere']){
  const p=await setup(t),w=await p.work(0,variant==='expired'?{issued:p.f.now()-2000,life:1000}:variant==='future'?{issued:p.f.now()+1}:variant==='long'?{life:p.f.catalogue.maxRequestLifetimeMs+1}:variant==='short'?{life:999}:{});
  if(variant==='revoked')p.f.store.relay.cancel(p.config.ownerId,p.config.allowedTaskId,w.grantId);
  if(variant==='drained')p.setAccepting(false);
  if(variant==='elsewhere'){const other=await p.work(1);other.grantId=w.grantId;other.payloadHash=await payloadHash(other);await p.f.store.relay.accept(other);}
  const r=await p.exchange(w);assert.notEqual(r.status,200,variant);assert.equal(p.f.store.get(w.eventId),null,variant);assert.equal(p.calls,0,variant);
 }
});

test('a pre-existing unapproved row is never promoted by a signed submission',async t=>{
 const p=await setup(t),w=await p.work();await p.f.store.relay.accept(w);assert.equal((await p.exchange(w)).status,403);assert.equal(p.router.acceptsWorkScope(w),false);assert.equal((await p.dispatcher().runOnce()).status,'idle');assert.equal(p.calls,0);
});

test('failed atomic persistence creates neither job, approval nor enrollment association',async t=>{
 const p=await setup(t),w=await p.work();p.f.faultAt(p.f.commits+2);assert.equal((await p.exchange(w)).status,403);assert.equal(p.f.store.get(w.eventId),null);assert.equal(p.sql(db=>db.prepare("SELECT count(*) AS n FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:signed-bridge:*' OR nonce GLOB 'picard-admission:v1:enrollment:*'").get().n),0);assert.equal(p.calls,0);
});

test('restart preserves signed approval and queued identity without a new owner challenge',async t=>{
 const p=await setup(t),w=await p.work();await p.exchange(w);const before=p.f.store.get(w.eventId);p.restart();assert.equal(p.router.acceptsWorkScope(w),true);assert.equal((await p.exchange(w)).status,200);assert.equal(p.f.store.get(w.eventId).payload_json,before.payload_json);assert.equal((await p.dispatcher().runOnce()).status,'completed');assert.equal(p.calls,1);p.restart();assert.equal((await p.exchange(w)).body.state,'completed');assert.equal(p.calls,1);
});

test('unknown result still stops the enrollment after catalogue replacement, with no replay',async t=>{
 const p=await setup(t,{response:'unknown'}),w=await p.work();await p.exchange(w);assert.equal((await p.dispatcher().runOnce()).status,'uncertain');assert.equal(p.calls,1);p.f.entry.slots.splice(0,1);const next=await p.work();assert.notEqual((await p.exchange(next)).status,200);assert.equal(p.f.store.get(next.eventId),null);assert.equal((await p.dispatcher().runOnce()).status,'idle');assert.equal(p.calls,1);
});

test('atomic boundary revalidates catalogue, historical review, rate and saved work bytes',async t=>{
 const p=await setup(t),w=await p.work();await p.exchange(w);p.sql(db=>db.prepare('UPDATE relay_jobs SET payload_json=? WHERE event_id=?').run(canonical({...w,request:{...w.request,text:'PRIVATE_TAMPER_SENTINEL'}}),w.eventId));assert.equal(p.router.acceptsWorkScope(w),false);assert.notEqual((await p.exchange(w)).status,200);assert.equal(p.calls,0);
 const r=await setup(t),x=await r.work();for(let i=0;i<10;i++)r.f.store.recordAttempt((await import('../experimental/runtime-control/src/admission-store.mjs')).admissionHash(canonical([r.config.ownerId,r.config.allowedTaskId])));assert.notEqual((await r.exchange(x)).status,200);assert.equal(r.f.store.get(x.eventId),null);assert.equal(r.calls,0);
});

test('catalogue replacement at the final atomic boundary cannot register stale work',async t=>{
 const p=await setup(t),w=await p.work();p.onPolicyRead(n=>{if(n===4)p.f.catalogue.entries=[];});assert.equal((await p.exchange(w)).status,403);assert.equal(p.f.store.get(w.eventId),null);assert.equal(p.sql(db=>db.prepare("SELECT count(*) AS n FROM relay_nonces WHERE nonce GLOB 'picard-admission:v1:enrollment:*' OR nonce GLOB 'picard-admission:v1:signed-bridge:*'").get().n),0);assert.equal(p.calls,0);
});

test('an unreviewed legacy row blocks signed ingress without backfill or reclassification',async t=>{
 const p=await setup(t),old=await p.work(1),w=await p.work();await p.f.store.relay.accept(old);p.sql(db=>db.prepare("UPDATE relay_jobs SET state='uncertain' WHERE event_id=?").run(old.eventId));const before=JSON.stringify(p.f.store.get(old.eventId));assert.equal((await p.exchange(w)).status,403);assert.equal(p.f.store.get(w.eventId),null);assert.equal(JSON.stringify(p.f.store.get(old.eventId)),before);assert.equal(p.calls,0);
});

test('crash before reply persistence and failed append both retain enrollment-wide stops across restart and catalogue replacement',async t=>{
 for(const kind of ['invoking','save-failure']){
  const p=await setup(t,{response:kind}),w=await p.work();await p.exchange(w);
  if(kind==='invoking'){const claim=p.router.claimNext({workerId:'before-crash',claimTtlMs:1000});p.f.store.relay.startInvocation({requestId:w.eventId,workerId:'before-crash',attempt:claim.attempt});}
  else{assert.equal((await p.dispatcher().runOnce()).status,'uncertain');assert.equal(p.calls,1);}
  p.restart();p.f.entry.slots.splice(0,1);assert.equal(p.router.ready,false);const next=await p.work();assert.equal((await p.exchange(next)).status,403);assert.equal(p.f.store.get(next.eventId),null);assert.equal(p.f.store.get(w.eventId).state,kind==='invoking'?'invoking':'uncertain');assert.equal(p.calls,kind==='invoking'?0:1);
 }
});

test('replaying the identical signed envelope is rejected without a second registration',async t=>{
 const p=await setup(t),w=await p.work(),signed=await signRequest('https://fixture.invalid/bridge/v1',{v:1,action:'exchange',ownerId:p.config.ownerId,payload:w},p.config);assert.equal((await p.handle()(signed.request.clone())).status,200);const duplicate=await p.handle()(signed.request);assert.equal(duplicate.status,409);assert.equal(duplicate.headers.has('x-bridge-response'),false);assert.equal((await duplicate.json()).error,'replayed_request');assert.equal(p.sql(db=>db.prepare('SELECT count(*) AS n FROM relay_jobs').get().n),1);assert.equal(p.calls,0);
});
