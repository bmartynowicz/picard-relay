import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,chmodSync,existsSync,readFileSync,writeFileSync,unlinkSync,linkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGroqAdapter,GROQ_MODEL,GROQ_ID,inputDigest,costEnrollmentDigest} from '../src/groq-adapter.mjs';
import {createGroqOnceAdapter} from '../src/groq-once-adapter.mjs';
import {createFreeOnlyRoutingAdapter} from '../src/selected-assistant.mjs';
import {createRelayStore,isDurableIncompleteFailureReceipt,recentJobReason} from '../src/relay-store.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
import {InvocationIncompleteError,isIncompleteInvocation,isIncompleteDiagnostic,withInvocationDiagnostic,decodeInvocationError,encodeInvocationError} from '../src/adapters.mjs';

const at=Date.now(),key='SYNTHETIC_FIXTURE_KEY_NOT_A_CREDENTIAL',sentinel='SYNTHETIC_PRIVATE_PARTIAL_SENTINEL';
const diagnostic={phase:'finish_reason',code:'finish_reason_rejected',httpStatus:200,finishReason:'length'};
const context={title:'Synthetic incomplete response',nextAction:'Review without execution',latestFinding:'Synthetic metadata only'};
const incomplete=(content=sentinel)=>({id:'synthetic-response',model:GROQ_MODEL,choices:[{finish_reason:'length',message:{role:'assistant',content}}]});
const reply=data=>new Response(JSON.stringify(data));
const enrollment={v:1,provider:'groq',model:GROQ_MODEL,owner:'fixture-owner',accountLabel:'Synthetic Free fixture',organizationId:'fixture-org',projectId:'fixture-project',keySha256:createHash('sha256').update(key).digest('hex'),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-86400000,enrolledAt:at-10000,evidenceRef:'SYNTHETIC_ORIGINAL_EVIDENCE',keyAssociationEvidenceRef:'SYNTHETIC_ASSOCIATION'};
async function scope(n=1){
 const requestText='Review synthetic case '+n,requestId='fixture-message-'+n,eventId=await digest(canonical(['fixture-owner','fixture-task',requestId]));
 const p={v:1,eventId,ownerId:'fixture-owner',taskId:'fixture-task',requestId,grantId:'fixture-grant-'+n,assistantId:GROQ_ID,grantExpiresAt:at+60000,request:{text:requestText,createdAt:new Date(at).toISOString(),answerTo:null},context};p.payloadHash=await payloadHash(p);
 const gate={v:3,purpose:'sanitized-source-proposal',provider:'groq',model:GROQ_MODEL,harmlessTestOnly:true,maxCalls:1,owner:p.ownerId,task:p.taskId,grantId:p.grantId,eventId,approvedRequestText:requestText,taskContext:context,approvedInputSha256:inputDigest({requestText,context:{taskContext:context}}),costEnrollment:enrollment,enrollmentId:costEnrollmentDigest(enrollment),requestIssuedAt:at-1000,requestExpiresAt:p.grantExpiresAt};
 const input={owner:p.ownerId,task:p.taskId,requestId:eventId,invocationId:eventId,requestText,context:{taskContext:context,grantId:p.grantId},attempt:1};
 return {p,gate,input};
}
async function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'picard-incomplete-'));chmodSync(dir,0o700);let clock=at,store=createRelayStore({dbPath:join(dir,'ledger.sqlite'),now:()=>clock});
 const first=await scope(),second=await scope(2);const board={scopeEnforced:true,getTaskContext:input=>store.getTaskContext(input),appendReply:input=>store.appendReply(input),getReplyByRequestId:id=>store.getReplyByRequestId(id)};
 const dispatch=adapter=>createDispatcher({store,boardAdapter:board,assistantAdapter:adapter,enabled:true,production:true,dbPath:join(dir,'ledger.sqlite'),workerId:'fixture',claimTtlMs:1000}).runOnce();
 try{await fn({dir,first,second,board,dispatch,get store(){return store;},advance:ms=>{clock+=ms},reopen(){store.close();store=createRelayStore({dbPath:join(dir,'ledger.sqlite'),now:()=>clock})}});}finally{store.close();rmSync(dir,{recursive:true,force:true});}}
function transport(s,fetchImpl){return createGroqAdapter({enabled:true,apiKey:key,gate:{...s.gate,requestId:s.p.eventId,inputSha256:s.gate.approvedInputSha256},fetchImpl,now:()=>at});}
function boundary(s,fetchImpl,finalizeIncomplete){const adapter=transport(s,fetchImpl);return {kind:'synthetic-transport-boundary',assistantId:GROQ_ID,ready:true,acceptsWorkScope:p=>canonical(p)===canonical(s.p),answer:input=>adapter.answer(input),finalizeIncomplete};}
const posix={skip:process.platform==='win32'?'Real POSIX marker ownership/fsync qualification required':false};

for(const partial of [sentinel,'',null])test('HTTP200 length with inert content is typed incomplete, never a partial result: '+String(partial).slice(0,12),async()=>{
 const s=await scope();let calls=0;const a=transport(s,async(_url,options)=>{calls++;const request=JSON.parse(options.body);assert.equal(request.max_completion_tokens,512);assert.equal(request.reasoning_effort,'low');assert.equal(request.tool_choice,'none');assert.equal(request.n,1);assert.equal(request.stream,false);return reply(incomplete(partial));});
 await assert.rejects(()=>a.answer(s.input),e=>{assert.equal(e.code,'groq_output_incomplete');assert.equal(isIncompleteInvocation(e),true);assert.equal(isIncompleteDiagnostic(e.diagnostic),true);assert.equal(JSON.stringify(e).includes(sentinel),false);return true});
 await assert.rejects(()=>a.answer(s.input));assert.equal(calls,1);
});

for(const patch of [{message:undefined},{message:{role:'tool',content:sentinel}},{message:{role:'assistant',content:{private:sentinel}}},{message:{role:'assistant',content:sentinel,tool_calls:[{private:sentinel}]}},{message:{role:'assistant',content:sentinel,tool_calls:{}}},{message:{role:'assistant',content:sentinel,function_call:{name:'forbidden'}}},{message:{role:'assistant',content:'x'.repeat(3701)}}])test('malformed/tool/oversized length payload stays uncertain: '+JSON.stringify(patch).slice(0,75),async()=>{
 const s=await scope(),data=incomplete();Object.assign(data.choices[0],patch);let calls=0;const a=transport(s,async()=>{calls++;return reply(data)});
 await assert.rejects(()=>a.answer(s.input),e=>{assert.equal(e.code,'groq_outcome_uncertain');assert.equal(isIncompleteInvocation(e),false);assert.equal(JSON.stringify(e).includes(sentinel),false);return true});assert.equal(calls,1);
});
for(const status of [201,206,402,429,500])test('non200 status is never acknowledged as known truncation: '+status,async()=>{
 const s=await scope();let calls=0;const a=transport(s,async()=>{calls++;return new Response(JSON.stringify(incomplete()),{status})});await assert.rejects(()=>a.answer(s.input),e=>!isIncompleteInvocation(e)&&!JSON.stringify(e).includes(sentinel));assert.equal(calls,1);
});
for(const finish of ['Length','stop ',null,{},'tool_calls'])test('unrecognized or tool finish is never incomplete: '+JSON.stringify(finish),async()=>{
 const s=await scope(),data=incomplete();data.choices[0].finish_reason=finish;await assert.rejects(()=>transport(s,async()=>reply(data)).answer(s.input),e=>e.code==='groq_outcome_uncertain'&&!isIncompleteInvocation(e));
});
test('a forged transport error cannot turn unknown I/O into known incomplete',async()=>{
 const s=await scope();const forged=withInvocationDiagnostic(new InvocationIncompleteError(),diagnostic);await assert.rejects(()=>transport(s,async()=>{throw forged}).answer(s.input),e=>e.code==='groq_outcome_uncertain'&&!isIncompleteInvocation(e));
});
test('aborted length response stays uncertain',async()=>{
 const s=await scope(),abort=new AbortController();const a=transport(s,async()=>{abort.abort();return reply(incomplete())});await assert.rejects(()=>a.answer({...s.input,signal:abort.signal}),e=>e.code==='groq_outcome_uncertain'&&!isIncompleteInvocation(e));
});
test('length with a wrong model or malformed identity remains uncertain',async()=>{
 const s=await scope();for(const patch of [{model:'unapproved'},{id:null},{choices:[]}]){let calls=0;const a=transport(s,async()=>{calls++;return reply({...incomplete(),...patch})});await assert.rejects(()=>a.answer(s.input),e=>e.code==='groq_outcome_uncertain'&&!isIncompleteInvocation(e));assert.equal(calls,1);}
});
test('only the same untouched committed receipt carries settlement authority',()=>fixture(async f=>{
 await f.store.accept(f.first.p);const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000}),owned={requestId:claim.event_id,attempt:claim.attempt,workerId:'fixture'};f.store.startInvocation(owned);const receipt=f.store.markFailed({...owned,error:'groq_output_incomplete',diagnostic});assert.equal(isDurableIncompleteFailureReceipt(receipt,claim.event_id),true);assert.equal(isDurableIncompleteFailureReceipt(receipt,f.second.p.eventId),false);const original=receipt.last_error;receipt.last_error='changed';assert.equal(isDurableIncompleteFailureReceipt(receipt,claim.event_id),false);receipt.last_error=original;assert.equal(isDurableIncompleteFailureReceipt(JSON.parse(JSON.stringify(receipt)),claim.event_id),false);
}));

test('durable terminal failure precedes settlement, stores no partial text and never reclaims',()=>fixture(async f=>{
 let calls=0,settled=0;await f.store.accept(f.first.p);
 const adapter=boundary(f.first,async()=>{calls++;return reply(incomplete())},async({requestId,error,failureReceipt})=>{
  assert.equal(isIncompleteInvocation(error),true);assert.equal(isDurableIncompleteFailureReceipt(failureReceipt,requestId),true);assert.equal(isDurableIncompleteFailureReceipt({...failureReceipt},requestId),false);assert.equal(isDurableIncompleteFailureReceipt(f.store.get(requestId),requestId),false);assert.equal(f.store.get(requestId).state,'failed');settled++;
 });
 const result=await f.dispatch(adapter);assert.equal(result.status,'failed');assert.equal(result.code,'groq_output_incomplete');assert.equal(settled,1);assert.equal(calls,1);
 let row=f.store.get(f.first.p.eventId);assert.equal(row.response_id,null);assert.equal(row.result_json,null);assert.equal(JSON.stringify(row).includes(sentinel),false);assert.equal(recentJobReason(row.state,row.last_error,false),'output_incomplete');
 f.reopen();row=f.store.get(f.first.p.eventId);assert.equal(row.state,'failed');assert.equal(isDurableIncompleteFailureReceipt(row,row.event_id),false);f.advance(1001);assert.equal((await f.dispatch(adapter)).status,'idle');assert.equal(calls,1);
 const config={ownerId:f.first.p.ownerId,allowedTaskId:f.first.p.taskId,assistantId:GROQ_ID,keyId:'fixture',secret:'SYNTHETIC_HMAC_NOT_A_CREDENTIAL_1234567890'};
 const receiver=createReceiver({store:f.store,config,assistantAdapter:adapter});const signed=await signRequest('https://fixture.invalid/bridge/v1',{v:1,action:'result',ownerId:f.first.p.ownerId,taskId:f.first.p.taskId,eventId:f.first.p.eventId,payloadHash:f.first.p.payloadHash},config);const response=await receiver(signed.request),body=await verifyResponse(response,signed.nonce,config);assert.deepEqual(body,{state:'failed',code:'groq_output_incomplete'});
}));
test('failed persistence cannot settle a reservation or fabricate terminal certainty',()=>fixture(async f=>{
 let calls=0,settled=0;await f.store.accept(f.first.p);const adapter=boundary(f.first,async()=>{calls++;return reply(incomplete())},async()=>{settled++});f.store.markFailed=()=>{throw Error(sentinel)};
 const result=await f.dispatch(adapter);assert.equal(result.status,'invoking');assert.equal(settled,0);assert.equal(calls,1);f.advance(1001);assert.equal((await f.dispatch(adapter)).status,'idle');assert.equal(f.store.get(f.first.p.eventId).state,'uncertain');assert.equal(calls,1);
}));
test('historical uncertain length record remains uncertain after reopen',()=>fixture(async f=>{
 await f.store.accept(f.first.p);const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000});const owned={requestId:claim.event_id,attempt:claim.attempt,workerId:'fixture'};f.store.startInvocation(owned);const row=f.store.markFailed({...owned,error:'groq_outcome_uncertain',diagnostic});assert.equal(row.state,'uncertain');f.reopen();assert.equal(f.store.get(claim.event_id).state,'uncertain');assert.equal(recentJobReason('uncertain',row.last_error,false),'outcome_uncertain');assert.equal(f.store.claimNext({workerId:'fixture',claimTtlMs:1000}),null);
}));
test('a bare incomplete code or hostile diagnostic cannot produce settlement proof',()=>fixture(async f=>{
 for(const [index,d] of [null,{...diagnostic,httpStatus:500},{...diagnostic,finishReason:sentinel},{...diagnostic,phase:'network'}].entries()){
  const s=await scope(index+5);await f.store.accept(s.p);const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000});const owned={requestId:claim.event_id,attempt:claim.attempt,workerId:'fixture'};f.store.startInvocation(owned);const row=f.store.markFailed({...owned,error:'groq_output_incomplete',diagnostic:d});assert.equal(row.state,'uncertain');assert.equal(isDurableIncompleteFailureReceipt(row,claim.event_id),false);
 }
}));

function durable(f,s,fetchImpl){return createFreeOnlyRoutingAdapter(createGroqOnceAdapter({enabled:true,apiKey:key,gate:s.gate,markerPath:join(f.dir,s.p.grantId+'.json'),fetchImpl,now:()=>at}));}
const latch=f=>join(f.dir,'.groq-cost-'+costEnrollmentDigest(enrollment)+'.pending');
test('real marker: known incomplete consumes once, permits a separately approved distinct grant',posix,()=>fixture(async f=>{
 let calls=0;const first=durable(f,f.first,async()=>{calls++;return reply(incomplete())});await f.store.accept(f.first.p);assert.equal((await f.dispatch(first)).status,'failed');assert.equal(existsSync(latch(f)),false);const marker=join(f.dir,f.first.p.grantId+'.json'),before=readFileSync(marker,'utf8');assert.equal(first.ready,false);assert.equal(durable(f,f.first,async()=>{throw Error('must not call')}).ready,false);
 const second=durable(f,f.second,async()=>{calls++;const data=incomplete('Synthetic complete result');data.choices[0].finish_reason='stop';return reply(data)});assert.equal(second.ready,true);await f.store.accept(f.second.p);assert.equal((await f.dispatch(second)).status,'completed');assert.equal(calls,2);assert.equal(readFileSync(marker,'utf8'),before);assert.equal(f.store.get(f.first.p.eventId).state,'failed');
}));
test('real marker: failed commit retains shared stop and consumed allowance across restart',posix,()=>fixture(async f=>{
 let calls=0;const first=durable(f,f.first,async()=>{calls++;return reply(incomplete())});await f.store.accept(f.first.p);f.store.markFailed=()=>{throw Error('synthetic persistence failure')};await f.dispatch(first);assert.equal(existsSync(latch(f)),true);assert.equal(existsSync(join(f.dir,f.first.p.grantId+'.json')),true);assert.equal(durable(f,f.second,async()=>{calls++;return reply(incomplete())}).ready,false);f.reopen();f.advance(1001);assert.equal((await f.dispatch(first)).status,'idle');assert.equal(f.store.get(f.first.p.eventId).state,'uncertain');assert.equal(calls,1);
}));
test('real marker: no durable receipt, copied receipt or reconstructed adapter can clear stop',posix,()=>fixture(async f=>{
 const a=createGroqOnceAdapter({enabled:true,apiKey:key,gate:f.first.gate,markerPath:join(f.dir,f.first.p.grantId+'.json'),fetchImpl:async()=>reply(incomplete()),now:()=>at});let error;try{await a.answer(f.first.input)}catch(e){error=e}assert.equal(isIncompleteInvocation(error),true);await assert.rejects(()=>a.finalizeIncomplete({requestId:f.first.p.eventId,error}));assert.equal(existsSync(latch(f)),true);
 await f.store.accept(f.first.p);const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000}),owned={requestId:claim.event_id,attempt:claim.attempt,workerId:'fixture'};f.store.startInvocation(owned);const receipt=f.store.markFailed({...owned,error:'groq_output_incomplete',diagnostic});await assert.rejects(()=>a.finalizeIncomplete({requestId:claim.event_id,error,failureReceipt:{...receipt}}));
 const recreated=createGroqOnceAdapter({enabled:true,apiKey:key,gate:f.first.gate,markerPath:join(f.dir,f.first.p.grantId+'.json'),now:()=>at});await assert.rejects(()=>recreated.finalizeIncomplete({requestId:claim.event_id,error,failureReceipt:receipt}));assert.equal(existsSync(latch(f)),true);await a.finalizeIncomplete({requestId:claim.event_id,error,failureReceipt:receipt});assert.equal(existsSync(latch(f)),false);
}));
for(const change of ['replace-inode','change-content','add-hardlink'])test('real marker: cleanup cannot erase a changed stop '+change,posix,()=>fixture(async f=>{
 const first=durable(f,f.first,async()=>reply(incomplete()));await f.store.accept(f.first.p);const wrapped={...first,finalizeIncomplete:async args=>{if(change==='replace-inode'){unlinkSync(latch(f));writeFileSync(latch(f),'replacement stop',{mode:0o600})}else if(change==='change-content')writeFileSync(latch(f),'changed same-inode stop');else linkSync(latch(f),join(f.dir,'stop-hardlink'));return first.finalizeIncomplete(args)}};
 const result=await f.dispatch(wrapped);assert.equal(result.status,'failed');assert.equal(existsSync(latch(f)),true);assert.equal(durable(f,f.second,async()=>{throw Error('must not call')}).ready,false);assert.equal(existsSync(join(f.dir,f.first.p.grantId+'.json')),true);
}));
for(const outcome of ['network','parse','payment','quota'])test('real marker: '+outcome+' still stops the enrollment without retry',posix,()=>fixture(async f=>{
 let calls=0;const first=durable(f,f.first,async()=>{calls++;if(outcome==='network')throw Error(sentinel);if(outcome==='parse')return new Response('{'+sentinel);return new Response(sentinel,{status:outcome==='payment'?402:429})});await f.store.accept(f.first.p);await f.dispatch(first);assert.equal(existsSync(latch(f)),true);assert.equal(durable(f,f.second,async()=>{calls++;return reply(incomplete())}).ready,false);assert.equal(calls,1);
}));
