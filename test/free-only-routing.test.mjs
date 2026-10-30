import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {FREE_ONLY_ROUTING_POLICY,createFreeOnlyRoutingAdapter,createSelectedAssistantAdapter} from '../experimental/runtime-control/src/selected-assistant.mjs';
import {createGroqAdapter,GROQ_ID,GROQ_MODEL,inputDigest} from '../experimental/runtime-control/src/groq-adapter.mjs';
import {createGroqOnceAdapter,PILOT_TEXT,PILOT_CONTEXT} from '../experimental/runtime-control/src/groq-once-adapter.mjs';
const blocked={code:'groq_free_scope_unavailable'};
const input={owner:'fixture-owner',task:'fixture-task',requestId:'a'.repeat(64),invocationId:'a'.repeat(64),attempt:1,requestText:PILOT_TEXT,context:{taskContext:PILOT_CONTEXT}};
const at=Date.now();
const gate={v:1,provider:'groq',model:GROQ_MODEL,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,evidenceRef:'OFFLINE_FIXTURE',verifiedAt:at-1,validUntil:at+60000,owner:input.owner,task:input.task,approvedRequestText:PILOT_TEXT,taskContext:PILOT_CONTEXT};
const fixture=answer=>({kind:'groq-durable-one-shot',assistantId:GROQ_ID,ready:true,canServeResults:true,acceptsWorkScope:()=>true,answer});

test('policy is immutable, fixed provider/model and bounded with zero retries or fallbacks',()=>{
 assert.equal(Object.isFrozen(FREE_ONLY_ROUTING_POLICY),true);
 assert.deepEqual(FREE_ONLY_ROUTING_POLICY,{id:'free-only-one-shot-v1',provider:'groq',model:GROQ_MODEL,maxCalls:1,maxInputBytes:12000,maxResponseBytes:65536,maxCompletionTokens:512,timeoutMs:30000,retries:0,fallbacks:0,productionTaskExecution:false});
});
test('missing, unknown, disabled or non-durable selection never reads credentials',async()=>{
 for(const env of [{},{BRIDGE_PROVIDER:'other'},{BRIDGE_PROVIDER:'groq'},{BRIDGE_PROVIDER:'groq',GROQ_ENABLED:'true',BRIDGE_ASSISTANT_ID:GROQ_ID},{BRIDGE_PROVIDER:'groq',GROQ_ENABLED:'true',BRIDGE_ASSISTANT_ID:'other',GROQ_ONE_SHOT:'true'}]){
  const a=createSelectedAssistantAdapter({...env,GROQ_API_KEY_FILE:'DOES_NOT_EXIST',GROQ_FREE_GATE_FILE:'DOES_NOT_EXIST'});
  assert.equal(a.ready,false);await assert.rejects(()=>a.answer(input));
 }
});
test('ephemeral, fixture and identity-substituted adapters cannot be routed',async()=>{
 for(const a of [undefined,{...fixture(()=>{}),kind:'groq-explicit-harmless-test'},{...fixture(()=>{}),kind:'controlled-local-fixture-only'},{...fixture(()=>{}),assistantId:'other'}]){
  const route=createFreeOnlyRoutingAdapter(a);assert.equal(route.ready,false);assert.equal(route.canServeResults,false);await assert.rejects(()=>route.answer(input),blocked);
 }
});
test('one synchronous reservation prevents concurrent duplicate invocation',async()=>{
 let calls=0,finish;const pending=new Promise(r=>finish=r);
 const route=createFreeOnlyRoutingAdapter(fixture(async()=>{calls++;await pending;return 'fixture answer';}));
 const first=route.answer(input);await assert.rejects(()=>route.answer(input),blocked);assert.equal(calls,1);finish();assert.equal(await first,'fixture answer');assert.equal(route.ready,false);assert.equal(route.canServeResults,true);
});
for(const code of ['groq_payment_required','groq_quota_exhausted','groq_request_rejected','groq_outcome_uncertain'])test(`${code} stops after one attempt`,async()=>{
 let calls=0;const route=createFreeOnlyRoutingAdapter(fixture(async()=>{calls++;throw Object.assign(Error(code),{code});}));
 await assert.rejects(()=>route.answer(input),{code});await assert.rejects(()=>route.answer(input),blocked);assert.equal(calls,1);assert.equal(route.canServeResults,true);
});
test('missing, paid, expired or widened Free gates make zero transport calls',async()=>{
 let calls=0;
 for(const patch of [null,{...gate,accountPlan:'Paid'},{...gate,validUntil:at},{...gate,verifiedAt:at+1},{...gate,maxCalls:2},{...gate,noPaidFallback:false},{...gate,model:'paid-model'}]){
  const a=createGroqAdapter({enabled:true,apiKey:'OFFLINE_FIXTURE',gate:patch&&{...patch,requestId:input.requestId,inputSha256:inputDigest(input)},fetchImpl:async()=>{calls++;throw Error('must not send');},now:()=>at});
  assert.equal(a.ready,false);await assert.rejects(()=>a.answer(input),blocked);
 }
 assert.equal(calls,0);
});
test('spent durable allowance stays blocked across reconstruction, with saved-result recovery',{skip:process.platform==='win32'?'POSIX private directory and fsync semantics required':false},async()=>{
 const dir=mkdtempSync(join(tmpdir(),'route-spent-'));chmodSync(dir,0o700);
 try{
  const markerPath=join(dir,'spent.json');writeFileSync(markerPath,'{"state":"consumed-before-io"}',{mode:0o600});let calls=0;
  const make=()=>createFreeOnlyRoutingAdapter(createGroqOnceAdapter({enabled:true,apiKey:'OFFLINE_FIXTURE',gate,markerPath,fetchImpl:async()=>{calls++;throw Error('must not send');},now:()=>at}));
  for(const a of [make(),make()]){assert.equal(a.ready,false);assert.equal(a.canServeResults,true);await assert.rejects(()=>a.answer(input),blocked);}assert.equal(calls,0);
  const keyPath=join(dir,'key'),gatePath=join(dir,'gate.json');writeFileSync(keyPath,'OFFLINE_FIXTURE',{mode:0o600});writeFileSync(gatePath,JSON.stringify(gate),{mode:0o600});
  const selected=createSelectedAssistantAdapter({BRIDGE_PROVIDER:'groq',GROQ_ENABLED:'true',BRIDGE_ASSISTANT_ID:GROQ_ID,GROQ_ONE_SHOT:'true',GROQ_API_KEY_FILE:keyPath,GROQ_FREE_GATE_FILE:gatePath,GROQ_ONCE_MARKER_FILE:markerPath,BRIDGE_OWNER_ID:input.owner,BRIDGE_ALLOWED_TASK_ID:input.task});
  assert.equal(selected.ready,false);assert.equal(selected.canServeResults,true);await assert.rejects(()=>selected.answer(input),blocked);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
