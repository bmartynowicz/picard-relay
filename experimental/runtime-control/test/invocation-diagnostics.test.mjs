import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AdapterBlockedError,TransportObservationError,sanitizeInvocationDiagnostic,encodeInvocationError,decodeInvocationError} from '../src/adapters.mjs';
import {createGroqAdapter,inputDigest,GROQ_MODEL,GROQ_ID} from '../src/groq-adapter.mjs';
import {createRelayStore} from '../src/relay-store.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
const SECRET='SYNTHETIC_REDACTION_SENTINEL_NOT_A_CREDENTIAL',at=Date.now();let passed=0;
const input={owner:'fixture-owner',task:'fixture-task',requestId:'fixture-request',invocationId:'fixture-request',attempt:1,requestText:SECRET,context:{taskContext:{title:'Synthetic diagnostic fixture',nextAction:'',latestFinding:SECRET}}};
const gate={provider:'groq',model:GROQ_MODEL,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,evidenceRef:'SYNTHETIC_ONLY',verifiedAt:at-1,validUntil:at+60000,owner:input.owner,task:input.task,requestId:input.requestId,inputSha256:inputDigest(input)};
const good={id:SECRET,model:GROQ_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Safe synthetic answer.'}}]};
const response=data=>new Response(JSON.stringify(data??good));
const factory=o=>createGroqAdapter({enabled:true,apiKey:SECRET,gate,now:()=>at,fetchImpl:async()=>response(),...o});
const safe=value=>assert.equal(JSON.stringify(value).includes(SECRET),false);
const test=async(name,fn)=>{await fn();passed++;console.log('PASS diagnostics '+name);};
async function fails({fetchImpl=async()=>response(),options={},invocation=input,phase,code,httpStatus=null,finishReason='unknown',errorCode='groq_outcome_uncertain',calls:expectedCalls=1}){
 let calls=0,error;const observations=[];
 const adapter=factory({...options,fetchImpl:async(...args)=>{calls++;return fetchImpl(...args);}});
 try{await adapter.answer({...invocation,onDiagnostic:d=>observations.push(d)});}catch(e){error=e;}
 assert.ok(error);assert.equal(error.code,errorCode);assert.deepEqual(error.diagnostic,{v:1,phase,code,httpStatus,finishReason});safe({code:error.code,message:error.message,diagnostic:error.diagnostic,observations});assert.equal(calls,expectedCalls);
 if(calls){await assert.rejects(()=>adapter.answer(invocation));assert.equal(calls,expectedCalls);assert.equal(adapter.ready,false);}
 return error;
}
await test('strict serializer ignores extra fields and hostile phase/code/status/reason',()=>{
 for(const v of [null,SECRET,{}, {phase:'__proto__',code:SECRET,httpStatus:SECRET,finishReason:SECRET},{phase:SECRET,code:SECRET,httpStatus:Infinity,finishReason:{secret:SECRET}}]){
  assert.deepEqual(sanitizeInvocationDiagnostic(v),{v:1,phase:'unknown',code:'unknown',httpStatus:null,finishReason:'unknown'});
  const encoded=encodeInvocationError(SECRET,v);assert.ok(encoded.length<300);safe(encoded);assert.equal(decodeInvocationError(encoded).code,'dispatcher_error');
 }
 for(const raw of [SECRET,'{bad '+SECRET,JSON.stringify({v:1,code:SECRET,diagnostic:{secret:SECRET},extra:SECRET}),'x'.repeat(1025)]){safe(decodeInvocationError(raw));assert.equal(decodeInvocationError(raw).code,'dispatcher_error');}
 assert.equal(decodeInvocationError('groq_outcome_uncertain').code,'groq_outcome_uncertain');assert.equal(decodeInvocationError('owner_revoked').code,'owner_revoked');
});
await test('expired scope fails before any transport',()=>fails({options:{gate:{...gate,validUntil:at}},phase:'pre_send',code:'scope_unavailable',errorCode:'groq_free_scope_unavailable',calls:0}));
await test('wrong identity fails before transport',()=>fails({invocation:{...input,owner:'other'},phase:'pre_send',code:'scope_mismatch',errorCode:'groq_scope_mismatch',calls:0}));
await test('pre-cancelled request fails before transport',()=>{const c=new AbortController();c.abort(SECRET);return fails({invocation:{...input,signal:c.signal},phase:'pre_send',code:'cancelled_before_send',errorCode:'groq_cancelled_before_send',calls:0});});
await test('oversized approved input fails before transport',()=>{const i={...input,requestText:'x'.repeat(12001)};return fails({invocation:i,options:{gate:{...gate,inputSha256:inputDigest(i)}},phase:'pre_send',code:'input_too_large',errorCode:'groq_input_too_large',calls:0});});
await test('untrusted exception strings and forged metadata never become observations',()=>fails({fetchImpl:async()=>{throw Object.assign(Error(SECRET),{code:SECRET,diagnostic:{phase:'http',code:'http_rejected',httpStatus:402,finishReason:'length'},body:SECRET,headers:{Authorization:SECRET}});},phase:'network',code:'network_failed'}));
await test('untrusted blocked exception cannot substitute a provider outcome',()=>fails({fetchImpl:async()=>{throw new AdapterBlockedError(SECRET,SECRET);},phase:'network',code:'network_failed'}));
for(const status of [400,401,402,403,404,413,422,429,503,302])await test(`observed HTTP ${status} is bounded and never retried`,()=>fails({fetchImpl:async()=>new Response(SECRET,{status}),phase:'http',code:'http_rejected',httpStatus:status,errorCode:status===429?'groq_quota_exhausted':status===402?'groq_payment_required':status<500&&status!==302?'groq_request_rejected':'groq_outcome_uncertain'}));
for(const status of [undefined,null,'200',0,-1,600,Infinity,200.5,{secret:SECRET}])await test(`malformed HTTP status ${typeof status} maps to unknown`,()=>fails({fetchImpl:async()=>({ok:true,status,body:null}),phase:'validation',code:'invalid_response'}));
for(const [ok,status] of [[true,503],[false,200],['true',200]])await test('inconsistent HTTP response flags fail validation',()=>fails({fetchImpl:async()=>({ok,status,body:null}),phase:'validation',code:'invalid_response',httpStatus:status}));
await test('missing body is distinct from no response',()=>fails({fetchImpl:async()=>({ok:true,status:200,body:null}),phase:'body',code:'body_missing',httpStatus:200}));
await test('body stream error preserves observed status without raw error text',()=>fails({fetchImpl:async()=>({ok:true,status:200,body:{getReader:()=>({read:async()=>{throw Error(SECRET);}})}}),phase:'body',code:'body_read_failed',httpStatus:200}));
await test('body size limit is observed without retaining provider body',()=>fails({fetchImpl:async()=>new Response(SECRET+'x'.repeat(65537)),phase:'body',code:'body_too_large',httpStatus:200}));
await test('HTTP body-cancel error keeps status without claiming a provider result',()=>fails({fetchImpl:async()=>({ok:false,status:402,body:{cancel:async()=>{throw Error(SECRET);}}}),phase:'http',code:'http_rejected',httpStatus:402}));
await test('JSON parse failure is distinct and redacted',()=>fails({fetchImpl:async()=>new Response('{bad '+SECRET),phase:'parse',code:'json_parse_failed',httpStatus:200}));
for(const data of [null,{...good,model:SECRET},{...good,id:''},{...good,choices:[]},{...good,choices:[{...good.choices[0],message:{role:'assistant',content:'x'.repeat(3701)}}]}])await test('invalid response shape is distinct from parse/finish failure',()=>fails({fetchImpl:async()=>new Response(JSON.stringify(data)),phase:'validation',code:'invalid_response',httpStatus:200,finishReason:data?.choices?.[0]?.finish_reason==='stop'?'stop':'unknown'}));
for(const reason of ['length','tool_calls','function_call','content_filter',SECRET,null,42,{secret:SECRET}])await test(`finish reason ${typeof reason} is allowlisted without claiming execution`,()=>fails({fetchImpl:async()=>response({...good,choices:[{...good.choices[0],finish_reason:reason}]}),phase:'finish_reason',code:'finish_reason_rejected',httpStatus:200,finishReason:['length','tool_calls','function_call','content_filter'].includes(reason)?reason:'unknown',errorCode:reason==='length'?'groq_output_incomplete':'groq_outcome_uncertain'}));
await test('known local deadline abort is distinguished from network error',async()=>{const keep=setTimeout(()=>{},100);try{await fails({options:{timeoutMs:5},fetchImpl:async(_,o)=>new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Error(SECRET)),{once:true})),phase:'timeout',code:'deadline_exceeded'});}finally{clearTimeout(keep);}});
await test('caller cancellation after local call boundary is distinguished',()=>{const c=new AbortController();return fails({invocation:{...input,signal:c.signal},fetchImpl:async()=>{c.abort(SECRET);throw Error(SECRET);},phase:'cancel',code:'cancelled_after_start'});});
await test('typed native redirect carries only observed bounded status',()=>fails({fetchImpl:async()=>{throw new TransportObservationError('transport_redirect_rejected',307);},phase:'http',code:'transport_redirect_rejected',httpStatus:307}));
await test('typed native timeout carries no raw native exception',()=>fails({fetchImpl:async()=>{throw new TransportObservationError('transport_timeout');},phase:'timeout',code:'deadline_exceeded'}));
await test('diagnostic persistence failure before transport stops without an invocation',async()=>{
 let calls=0,error;const adapter=factory({fetchImpl:async()=>{calls++;return response();}});
 try{await adapter.answer({...input,onDiagnostic:()=>{throw Error(SECRET);}});}catch(e){error=e;}
 assert.equal(calls,0);assert.equal(adapter.ready,false);assert.equal(error.diagnostic.code,'diagnostic_persistence_failed');safe({code:error.code,message:error.message,diagnostic:error.diagnostic});
});
await test('validated response diagnostic write failure remains uncertain and single call',async()=>{
 let calls=0,error;const adapter=factory({fetchImpl:async()=>{calls++;return response();}});
 try{await adapter.answer({...input,onDiagnostic:d=>{if(d.code==='response_validated')throw Error(SECRET);}});}catch(e){error=e;}
 assert.equal(calls,1);assert.deepEqual(error.diagnostic,{v:1,phase:'unknown',code:'diagnostic_persistence_failed',httpStatus:200,finishReason:'stop'});safe(error.diagnostic);await assert.rejects(()=>adapter.answer(input));assert.equal(calls,1);
});
async function withStore(fn){const dir=mkdtempSync(join(tmpdir(),'picard-diagnostics-')),dbPath=join(dir,'ledger.sqlite');let clock=at;
 const eventId=await digest(canonical(['fixture-owner','fixture-task','fixture-message']));
 const p={v:1,eventId,ownerId:input.owner,taskId:input.task,requestId:'fixture-message',grantId:'fixture-grant',assistantId:GROQ_ID,grantExpiresAt:at+60000,request:{text:input.requestText,createdAt:new Date(at).toISOString(),answerTo:null},context:input.context.taskContext};p.payloadHash=await payloadHash(p);
 let store=createRelayStore({dbPath,now:()=>clock});await store.accept(p);
 const adapter=(fetchImpl=async()=>response())=>factory({gate:{...gate,requestId:eventId},fetchImpl});
 const board=()=>({kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId});
 try{await fn({dbPath,p,get store(){return store;},adapter,board,reopen:()=>{store.close();store=createRelayStore({dbPath,now:()=>clock});return store;},advance:ms=>{clock+=ms;}});}finally{store.close();rmSync(dir,{recursive:true,force:true});}
}
await test('failure observations persist across restart and signed result keeps original code only',()=>withStore(async f=>{
 let calls=0;const a=f.adapter(async()=>{calls++;return new Response('{bad '+SECRET);});
 const d=createDispatcher({store:f.store,boardAdapter:f.board(),assistantAdapter:a,enabled:true,production:true,dbPath:f.dbPath,workerId:'fixture'});const outcome=await d.runOnce();assert.equal(outcome.code,'groq_outcome_uncertain');safe(outcome);
 let row=f.store.get(f.p.eventId);assert.equal(row.state,'uncertain');assert.equal(outcome.status,row.state);assert.equal(row.response_id,null);assert.equal(row.result_json,null);assert.equal(decodeInvocationError(row.last_error).diagnostic.phase,'parse');safe(row.last_error);
 f.reopen();row=f.store.get(f.p.eventId);assert.equal(decodeInvocationError(row.last_error).diagnostic.code,'json_parse_failed');assert.equal((await createDispatcher({store:f.store,boardAdapter:f.board(),assistantAdapter:a,enabled:true}).runOnce()).status,'idle');assert.equal(calls,1);
 const config={ownerId:input.owner,allowedTaskId:input.task,assistantId:GROQ_ID,keyId:'fixture',secret:'SYNTHETIC_HMAC_NOT_A_REAL_CREDENTIAL_123456'};
 const receiver=createReceiver({store:f.store,config,assistantAdapter:a});
 const request=async patch=>{const s=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'result',ownerId:input.owner,taskId:input.task,eventId:f.p.eventId,payloadHash:f.p.payloadHash,...patch},config),r=await receiver(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};};
 const signed=await request({});assert.equal(signed.status,200);assert.deepEqual(signed.body,{state:'uncertain',code:'groq_outcome_uncertain'});safe(signed);assert.equal((await request({ownerId:'other'})).status,403);assert.equal((await request({taskId:'other'})).status,403);
}));
await test('crash recovery retains last observation and stays uncertain without making a call',()=>withStore(async f=>{
 const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:100});const identity={requestId:claim.event_id,workerId:'fixture',attempt:claim.attempt};f.store.startInvocation(identity);
 f.store.recordInvocationDiagnostic({...identity,diagnostic:{phase:'network',code:'transport_call_pending'}});f.reopen();f.advance(101);assert.equal(f.store.claimNext({workerId:'new-worker',claimTtlMs:100}),null);
 const row=f.store.get(f.p.eventId),saved=decodeInvocationError(row.last_error);assert.equal(row.state,'uncertain');assert.equal(saved.code,'invocation_outcome_uncertain');assert.equal(saved.diagnostic.code,'transport_call_pending');assert.equal(saved.diagnostic.httpStatus,null);assert.equal(saved.diagnostic.finishReason,'unknown');
}));
await test('legacy invoking row remains readable without schema or diagnostics migration',()=>withStore(async f=>{
 const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:100});f.store.startInvocation({requestId:claim.event_id,workerId:'fixture',attempt:claim.attempt});f.reopen();f.advance(101);f.store.claimNext({workerId:'new-worker',claimTtlMs:100});assert.equal(f.store.get(f.p.eventId).last_error,'invocation_outcome_uncertain');
}));
await test('diagnostic writes require active claim identity and cannot alter another worker history',()=>withStore(async f=>{
 const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:100});assert.throws(()=>f.store.recordInvocationDiagnostic({requestId:claim.event_id,workerId:'other',attempt:claim.attempt,diagnostic:{phase:'http',code:'http_rejected',httpStatus:402}}),{code:'claim_mismatch'});assert.equal(f.store.get(f.p.eventId).last_error,null);
}));
await test('stored hostile diagnostic fields are redacted and progress never crosses signed result transport',()=>withStore(async f=>{
 const claim=f.store.claimNext({workerId:'fixture',claimTtlMs:1000});f.store.startInvocation({requestId:claim.event_id,workerId:'fixture',attempt:claim.attempt});f.store.recordInvocationDiagnostic({requestId:claim.event_id,workerId:'fixture',attempt:claim.attempt,diagnostic:{phase:SECRET,code:SECRET,httpStatus:SECRET,finishReason:SECRET,headers:{Authorization:SECRET},body:SECRET}});
 safe(f.store.get(f.p.eventId).last_error);const config={ownerId:input.owner,allowedTaskId:input.task,assistantId:GROQ_ID,keyId:'fixture',secret:'SYNTHETIC_HMAC_NOT_A_REAL_CREDENTIAL_123456'};const receiver=createReceiver({store:f.store,config,assistantAdapter:f.adapter()});const s=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'result',ownerId:input.owner,taskId:input.task,eventId:f.p.eventId,payloadHash:f.p.payloadHash},config),r=await receiver(s.request);assert.deepEqual(await verifyResponse(r,s.nonce,config),{state:'invoking'});
}));
for(const stage of ['result_commit','completion_commit'])await test(`${stage} failure records only its observed boundary and never repeats provider`,()=>withStore(async f=>{
 let calls=0;const a=f.adapter(async()=>{calls++;return response();}),board=f.board(),store={...f.store};
 if(stage==='result_commit')board.appendReply=async()=>{throw Object.assign(Error(SECRET),{code:SECRET,diagnostic:{secret:SECRET}});};else store.markCompleted=async()=>{throw Error(SECRET);};
 const d=createDispatcher({store,boardAdapter:board,assistantAdapter:a,enabled:true,workerId:'fixture'}),outcome=await d.runOnce();safe(outcome);const row=f.store.get(f.p.eventId),saved=decodeInvocationError(row.last_error);safe(saved);assert.equal(saved.diagnostic.phase,stage);assert.equal(saved.diagnostic.code,stage+'_failed');assert.equal(saved.diagnostic.httpStatus,200);assert.equal(saved.diagnostic.finishReason,'stop');assert.equal(row.state,stage==='result_commit'?'uncertain':'failed');assert.equal(calls,1);await d.runOnce();assert.equal(calls,1);f.reopen();assert.equal(decodeInvocationError(f.store.get(f.p.eventId).last_error).diagnostic.phase,stage);
}));
await test('failed diagnostic persistence stops before invocation and redacts storage error',()=>withStore(async f=>{
 let calls=0;const store={...f.store,recordInvocationDiagnostic:()=>{throw Error(SECRET);}},a=f.adapter(async()=>{calls++;return response();});const outcome=await createDispatcher({store,boardAdapter:f.board(),assistantAdapter:a,enabled:true,workerId:'fixture'}).runOnce();safe(outcome);assert.equal(calls,0);const saved=decodeInvocationError(f.store.get(f.p.eventId).last_error);assert.equal(saved.diagnostic.code,'diagnostic_persistence_failed');safe(saved);
}));
console.log(`${passed} invocation-diagnostics fixture groups passed; ZERO live API calls.`);
