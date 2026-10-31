import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {createGroqOnceAdapter} from '../src/groq-once-adapter.mjs';
import {GROQ_MODEL,inputDigest,costEnrollmentDigest} from '../src/groq-adapter.mjs';
import {createRelayStore} from '../src/relay-store.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
const at=Date.now(),requestText='Review public routing code: propose three duplicate-invocation regression cases.',taskContext={title:'Public routing review',nextAction:'Save answer',latestFinding:'Public source only'};
const eventId=await digest(canonical(['owner','task','message-2']));
const gate={v:2,purpose:'public-source-review',provider:'groq',model:GROQ_MODEL,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,evidenceRef:'FIXTURE_ONLY',verifiedAt:at-1,validUntil:at+60000,owner:'owner',task:'task',grantId:'new-grant',eventId,approvedRequestText:requestText,taskContext,approvedInputSha256:inputDigest({requestText,context:{taskContext}})};
const input={owner:'owner',task:'task',requestId:eventId,invocationId:eventId,attempt:1,requestText,context:{taskContext,grantId:gate.grantId}};
const payload={v:1,eventId,ownerId:'owner',taskId:'task',requestId:'message-2',grantId:'new-grant',assistantId:'groq:'+GROQ_MODEL,grantExpiresAt:at+60000,request:{text:requestText,createdAt:new Date(at).toISOString(),answerTo:null},context:taskContext};payload.payloadHash=await payloadHash(payload);
// Synthetic sanitized fixture only: no private project source or descriptors.
const proposalText='Propose a short CSS snippet for this synthetic fixture: .fixture-panel { display: block; }';
const proposalContext={title:'Synthetic proposal fixture',nextAction:'Return review-only text',latestFinding:'Sanitized synthetic input; no public-source claim'};
const proposalGate={...gate,purpose:'sanitized-source-proposal',grantId:'proposal-grant',approvedRequestText:proposalText,taskContext:proposalContext,approvedInputSha256:inputDigest({requestText:proposalText,context:{taskContext:proposalContext}})};
const proposalInput={...input,requestText:proposalText,context:{taskContext:proposalContext,grantId:proposalGate.grantId}};
const proposalPayload={...payload,grantId:proposalGate.grantId,request:{...payload.request,text:proposalText},context:proposalContext};proposalPayload.payloadHash=await payloadHash(proposalPayload);
let n=0;
async function test(name,fn){const dir=mkdtempSync(join(tmpdir(),'picard-approved-'));let calls=0;const markerPath=join(dir,'new.json');const fetchImpl=async()=>{calls++;assert.equal(existsSync(markerPath),true);return new Response(JSON.stringify({id:'fixture',model:GROQ_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Test concurrent duplicate requests; assert one outbound invocation.'}}]}));};const create=(o={})=>createGroqOnceAdapter({enabled:true,apiKey:'FIXTURE_ONLY',gate,markerPath,fetchImpl,now:()=>at,...o});try{await fn({dir,markerPath,create,calls:()=>calls});n++;console.log('PASS '+name);}finally{rmSync(dir,{recursive:true,force:true});}}
await test('useful exact scope succeeds once and preserves old consumed marker',async({dir,create,calls,markerPath})=>{const old=join(dir,'old.json');writeFileSync(old,'old-consumed-evidence');const a=create();assert.equal(a.ready,true);assert.equal(a.acceptsWorkScope(payload),true);const r=await a.answer(input);assert.match(r.body,/concurrent duplicate/);assert.equal(calls(),1);assert.equal(readFileSync(old,'utf8'),'old-consumed-evidence');assert.equal(JSON.parse(readFileSync(markerPath)).requestId,eventId);assert.equal(create().ready,false);await assert.rejects(()=>create().answer(input));assert.equal(calls(),1);});
await test('wire scope binds exact owner task event grant text context and answerTo',async({create,calls})=>{const a=create();for(const p of [{...payload,ownerId:'other'},{...payload,taskId:'other'},{...payload,eventId:'a'.repeat(64)},{...payload,grantId:'old-grant'},{...payload,request:{...payload.request,text:'other'}},{...payload,context:{...taskContext,latestFinding:'changed'}},{...payload,request:{...payload.request,answerTo:'q'}}])assert.equal(a.acceptsWorkScope(p),false);assert.equal(calls(),0);});
await test('invocation identity and input digest fail closed before marker/network',async({create,calls,markerPath})=>{const a=create();for(const p of [{...input,requestId:'a'.repeat(64),invocationId:'a'.repeat(64)},{...input,requestText:'other'},{...input,context:{taskContext:{...taskContext,title:'changed'}}},{...input,owner:'other'},{...input,invocationId:'a'.repeat(64)}])await assert.rejects(()=>a.answer(p));assert.equal(calls(),0);assert.equal(existsSync(markerPath),false);});
await test('invalid gate and wider authority rejected',async({create})=>{for(const change of [{v:3},{purpose:'arbitrary-execution'},{approvedInputSha256:'a'.repeat(64)},{maxCalls:2},{accountPlan:'Paid'},{noPaidFallback:false},{grantId:''},{eventId:'bad'},{approvedRequestText:'x'.repeat(4001)},{taskContext:{...taskContext,extra:'no'}},{validUntil:at+3600001}])assert.equal(create({gate:{...gate,...change}}).ready,false);});
await test('caller gate mutation cannot widen snapshotted scope',async({create})=>{const mutable=structuredClone(gate),a=create({gate:mutable});mutable.approvedRequestText='different';mutable.eventId='a'.repeat(64);assert.equal(a.acceptsWorkScope(payload),true);assert.equal(a.acceptsWorkScope({...payload,eventId:mutable.eventId}),false);});
await test('concurrent adapters have one durable allowance and failure never replenishes',async({create,calls})=>{const results=await Promise.allSettled([create().answer(input),create().answer(input)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls(),1);assert.equal(create().ready,false);});
await test('network ambiguity never retries or replenishes allowance',async({create,markerPath})=>{let calls=0;await assert.rejects(()=>create({fetchImpl:async()=>{calls++;throw Error('ambiguous');}}).answer(input));assert.equal(calls,1);assert.equal(existsSync(markerPath),true);assert.equal(create().ready,false);});
for(const status of [402,429])await test(`HTTP ${status} consumes allowance without retry/fallback`,async({create,markerPath})=>{let calls=0;const a=create({fetchImpl:async()=>{calls++;return new Response('',{status});}});await assert.rejects(()=>a.answer(input));assert.equal(calls,1);assert.equal(existsSync(markerPath),true);await assert.rejects(()=>create().answer(input));assert.equal(calls,1);});
await test('expired scope blocks new work while saved-result capability remains',async({create})=>{const a=create({now:()=>at+60001});assert.equal(a.ready,false);assert.equal(a.canServeResults,true);await assert.rejects(()=>a.answer(input));});
await test('signed exchange dispatch result and replay use one invocation only',async({dir,create,calls})=>{const store=createRelayStore({dbPath:join(dir,'ledger.sqlite')}),adapter=create(),config={allowedTaskId:'task',ownerId:'owner',assistantId:'groq:'+GROQ_MODEL,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};const receiver=createReceiver({store,config,assistantAdapter:adapter});async function request(p){const s=await signRequest('https://relay.invalid/bridge/v1',p,config);const r=await receiver(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};}try{const exchange={v:1,action:'exchange',ownerId:'owner',payload};assert.equal((await request(exchange)).body.state,'queued');const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};const d=createDispatcher({store,boardAdapter,assistantAdapter:adapter,enabled:true,production:true,dbPath:join(dir,'ledger.sqlite'),workerId:'fixture'});assert.equal((await d.runOnce()).status,'completed');assert.equal((await request(exchange)).body.state,'completed');const r=await request({v:1,action:'result',ownerId:'owner',taskId:'task',eventId,payloadHash:payload.payloadHash});assert.match(r.body.result.body,/concurrent duplicate/);assert.equal(calls(),1);store.cancel('owner','task','new-grant');assert.notEqual((await request({v:1,action:'result',ownerId:'owner',taskId:'task',eventId,payloadHash:payload.payloadHash})).status,200);}finally{store.close();}});
await test('Groq receiver without exact scope validator rejects even ready adapter',async({dir})=>{const store=createRelayStore({dbPath:join(dir,'ledger.sqlite')}),config={allowedTaskId:'task',ownerId:'owner',assistantId:'groq:'+GROQ_MODEL,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};try{const receiver=createReceiver({store,config,assistantAdapter:{ready:true,assistantId:config.assistantId}}),s=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'exchange',ownerId:'owner',payload},config);assert.equal((await receiver(s.request)).status,403);assert.deepEqual(store.stats(),[]);}finally{store.close();}});
await test('sanitized proposal exact scope succeeds once and retains consumed history',async({dir,create,markerPath})=>{
 const old=join(dir,'prior-consumed.json');writeFileSync(old,'prior-consumed-fixture');let calls=0;
 const make=()=>create({gate:proposalGate,fetchImpl:async()=>{calls++;assert.equal(existsSync(markerPath),true);return new Response(JSON.stringify({id:'fixture',model:GROQ_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'```css\n.fixture-panel { padding: 1rem; }\n```'}}]}));}});
 const a=make();assert.equal(a.ready,true);assert.equal(a.acceptsWorkScope(proposalPayload),true);assert.equal(a.acceptsWorkScope(payload),false);
 const result=await a.answer(proposalInput);assert.match(result.body,/```css/);assert.equal(result.outcomeKind,'information');assert.equal(result.statusChange,null);assert.equal(calls,1);
 await assert.rejects(()=>a.answer(proposalInput));await assert.rejects(()=>make().answer(proposalInput));assert.equal(make().canServeResults,true);assert.equal(calls,1);assert.equal(readFileSync(old,'utf8'),'prior-consumed-fixture');
});
await test('sanitized purpose cannot widen owner task event grant text context or digest',async({create,markerPath,calls})=>{
 const a=create({gate:proposalGate});
 for(const p of [{...proposalPayload,ownerId:'other'},{...proposalPayload,taskId:'other'},{...proposalPayload,eventId:'b'.repeat(64)},{...proposalPayload,grantId:'other'},{...proposalPayload,request:{...proposalPayload.request,text:'changed'}},{...proposalPayload,context:{...proposalContext,latestFinding:'changed'}},{...proposalPayload,request:{...proposalPayload.request,answerTo:'q'}}])assert.equal(a.acceptsWorkScope(p),false);
 for(const patch of [{owner:'other'},{task:'other'},{requestText:'changed'},{requestId:'b'.repeat(64),invocationId:'b'.repeat(64)},{context:{taskContext:proposalContext,grantId:'other'}},{context:{taskContext:{...proposalContext,title:'changed'},grantId:proposalGate.grantId}}])await assert.rejects(()=>a.answer({...proposalInput,...patch}));
 for(const purpose of ['',null,'arbitrary-execution','SANITIZED-SOURCE-PROPOSAL','sanitized-source-proposal-extra'])assert.equal(create({gate:{...proposalGate,purpose}}).ready,false);
 assert.equal(create({gate:{...proposalGate,approvedInputSha256:'a'.repeat(64)}}).ready,false);assert.equal(calls(),0);assert.equal(existsSync(markerPath),false);
});
for(const status of [402,429,'network'])await test(`sanitized proposal ${status} never retries or replenishes`,async({create,markerPath})=>{
 let calls=0;const make=()=>create({gate:proposalGate,fetchImpl:async()=>{calls++;if(status==='network')throw Error('fixture ambiguity');return new Response('',{status});}});
 await assert.rejects(()=>make().answer(proposalInput));assert.equal(calls,1);assert.equal(existsSync(markerPath),true);await assert.rejects(()=>make().answer(proposalInput));assert.equal(calls,1);
});
await test('signed sanitized proposal uses unchanged v1 wire and saves inert result once',async({dir,create,calls})=>{
 const store=createRelayStore({dbPath:join(dir,'proposal.sqlite')}),adapter=create({gate:proposalGate}),config={allowedTaskId:'task',ownerId:'owner',assistantId:'groq:'+GROQ_MODEL,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};
 const receiver=createReceiver({store,config,assistantAdapter:adapter});
 async function request(p){const s=await signRequest('https://relay.invalid/bridge/v1',p,config),r=await receiver(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};}
 try{
  const exchange={v:1,action:'exchange',ownerId:'owner',payload:proposalPayload};assert.equal((await request(exchange)).body.state,'queued');
  const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
  const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter:adapter,enabled:true,production:true,dbPath:join(dir,'proposal.sqlite'),workerId:'fixture'});
  assert.equal((await dispatcher.runOnce()).status,'completed');assert.equal((await request(exchange)).body.state,'completed');assert.equal((await dispatcher.runOnce()).status,'idle');assert.equal(calls(),1);
  const result=await request({v:1,action:'result',ownerId:'owner',taskId:'task',eventId,payloadHash:proposalPayload.payloadHash});assert.equal(result.status,200);assert.equal(result.body.result.outcome.kind,'information');
  const changed={...proposalPayload,purpose:'sanitized-source-proposal'};changed.payloadHash=await payloadHash(changed);assert.notEqual((await request({...exchange,payload:changed})).status,200);assert.equal(calls(),1);
 }finally{store.close();}
});
const costEnrollment={v:1,provider:'groq',model:GROQ_MODEL,owner:'owner',accountLabel:'Synthetic account',organizationId:'fixture-org',projectId:'fixture-project',keySha256:createHash('sha256').update('FIXTURE_ONLY').digest('hex'),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-172800000,evidenceRef:'FIXTURE_ORIGINAL_OBSERVATION',keyAssociationEvidenceRef:'FIXTURE_OWNER_ASSOCIATION',enrolledAt:at-86400000};
const retainedGate={...gate,v:3,costEnrollment,enrollmentId:costEnrollmentDigest(costEnrollment),requestIssuedAt:at-1000,requestExpiresAt:payload.grantExpiresAt};
await test('v3 exact fresh request reuses original enrollment and consumes once',async({create,calls,dir})=>{
 const original=JSON.stringify(costEnrollment),a=create({gate:retainedGate});assert.equal(a.ready,true);assert.equal(a.acceptsWorkScope(payload),true);
 assert.equal(a.acceptsWorkScope({...payload,grantExpiresAt:payload.grantExpiresAt+1}),false);await a.answer(input);assert.equal(calls(),1);assert.equal(JSON.stringify(costEnrollment),original);
 assert.equal(create({gate:retainedGate}).ready,false);const later=at+7200000,next={...retainedGate,grantId:'next-exact-grant',eventId:'b'.repeat(64),requestIssuedAt:later,requestExpiresAt:later+60000};
 const b=create({gate:next,markerPath:join(dir,'next-exact-marker.json'),now:()=>later});assert.equal(b.ready,true);
 await b.answer({...input,requestId:next.eventId,invocationId:next.eventId,context:{taskContext,grantId:next.grantId}});assert.equal(calls(),2);
});
await test('v3 rejects changed enrollment key identity scope and expired request without I/O',async({create,calls,markerPath})=>{
 for(const patch of [{enrollmentId:'a'.repeat(64)},{costEnrollment:{...costEnrollment,projectId:'changed'}},{requestExpiresAt:at},{requestIssuedAt:at+1},{requestExpiresAt:at+3600001},{purpose:'arbitrary-execution'},{maxCalls:2}])assert.equal(create({gate:{...retainedGate,...patch}}).ready,false);
 assert.equal(create({gate:retainedGate,apiKey:'OTHER_FIXTURE'}).ready,false);
 const a=create({gate:retainedGate});for(const p of [{...payload,ownerId:'other'},{...payload,taskId:'other'},{...payload,eventId:'a'.repeat(64)},{...payload,grantId:'other'},{...payload,request:{...payload.request,text:'changed'}},{...payload,context:{...taskContext,title:'changed'}}])assert.equal(a.acceptsWorkScope(p),false);
 for(const patch of [{owner:'other'},{task:'other'},{requestText:'changed'},{requestId:'b'.repeat(64),invocationId:'b'.repeat(64)},{context:{taskContext,grantId:'other'}}])await assert.rejects(()=>a.answer({...input,...patch}));assert.equal(calls(),0);assert.equal(existsSync(markerPath),false);
});
for(const status of [402,429,'network'])await test(`v3 ${status} durably stops same enrollment across distinct grants and restart`,async({create,dir,markerPath})=>{
 let calls=0;const fetchImpl=async()=>{calls++;if(status==='network')throw Error('fixture ambiguity');return new Response('',{status});};
 await assert.rejects(()=>create({gate:retainedGate,fetchImpl}).answer(input));assert.equal(calls,1);assert.equal(existsSync(markerPath),true);
 const next={...retainedGate,grantId:'different-grant',eventId:'b'.repeat(64)},b=create({gate:next,markerPath:join(dir,'different-marker.json'),fetchImpl});assert.equal(b.ready,false);assert.equal(b.canServeResults,true);
 await assert.rejects(()=>b.answer({...input,requestId:next.eventId,invocationId:next.eventId,context:{taskContext,grantId:next.grantId}}));assert.equal(calls,1);
});
await test('v3 concurrent distinct grants share durable enrollment stop before I/O',async({create,dir})=>{
 let calls=0,finish;const fetchImpl=async()=>{calls++;await new Promise(r=>{finish=r;});return new Response(JSON.stringify({id:'fixture',model:GROQ_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic review.'}}]}));};
 const a=create({gate:retainedGate,fetchImpl}),pending=a.answer(input);assert.equal(calls,1);
 const next={...retainedGate,eventId:'b'.repeat(64),grantId:'other'},b=create({gate:next,markerPath:join(dir,'other.json'),fetchImpl});assert.equal(b.ready,false);await assert.rejects(()=>b.answer({...input,requestId:next.eventId,invocationId:next.eventId,context:{taskContext,grantId:next.grantId}}));
 finish();await pending;assert.equal(calls,1);assert.equal(b.ready,true);
});
await test('v3 preexisting pending file and old consumed markers are preserved',async({create,dir,calls})=>{
 const stop=join(dir,`.groq-cost-${retainedGate.enrollmentId}.pending`);writeFileSync(stop,'existing pending fixture');const old=join(dir,'old.json');writeFileSync(old,'old consumed fixture');
 const a=create({gate:retainedGate});assert.equal(a.ready,false);assert.equal(a.canServeResults,true);await assert.rejects(()=>a.answer(input));assert.equal(calls(),0);assert.equal(readFileSync(stop,'utf8'),'existing pending fixture');assert.equal(readFileSync(old,'utf8'),'old consumed fixture');
});
await test('v3 configuration snapshot and expired saved-result readiness retain original evidence',async({create,calls})=>{
 const mutable=structuredClone(retainedGate),a=create({gate:mutable});mutable.costEnrollment.projectId='changed';mutable.requestExpiresAt=at;
 assert.equal(a.ready,true);assert.equal(a.acceptsWorkScope(payload),true);assert.equal(create({gate:mutable}).ready,false);
 const expired=create({gate:retainedGate,now:()=>retainedGate.requestExpiresAt});assert.equal(expired.ready,false);assert.equal(expired.canServeResults,true);await assert.rejects(()=>expired.answer(input));assert.equal(calls(),0);
});
await test('v3 signed exchange preserves unchanged wire grant expiry and inert result history',async({dir,create,calls})=>{
 const store=createRelayStore({dbPath:join(dir,'v3.sqlite')}),adapter=create({gate:retainedGate}),config={allowedTaskId:'task',ownerId:'owner',assistantId:'groq:'+GROQ_MODEL,keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};
 const receiver=createReceiver({store,config,assistantAdapter:adapter});
 async function request(p){const s=await signRequest('https://relay.invalid/bridge/v1',p,config),r=await receiver(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};}
 try{
  const exchange={v:1,action:'exchange',ownerId:'owner',payload};assert.equal((await request(exchange)).body.state,'queued');
  const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
  const d=createDispatcher({store,boardAdapter,assistantAdapter:adapter,enabled:true,production:true,dbPath:join(dir,'v3.sqlite'),workerId:'fixture'});assert.equal((await d.runOnce()).status,'completed');assert.equal((await d.runOnce()).status,'idle');assert.equal(calls(),1);
  const result=await request({v:1,action:'result',ownerId:'owner',taskId:'task',eventId,payloadHash:payload.payloadHash});assert.equal(result.status,200);assert.equal(result.body.result.outcome.kind,'information');assert.equal(result.body.result.grantId,payload.grantId);
  const changed={...payload,grantExpiresAt:payload.grantExpiresAt+1};changed.payloadHash=await payloadHash(changed);assert.notEqual((await request({...exchange,payload:changed})).status,200);assert.equal(calls(),1);
 }finally{store.close();}
});
console.log(`${n} approved-work offline cases passed; zero live calls.`);
