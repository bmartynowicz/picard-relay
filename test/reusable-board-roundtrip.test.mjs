import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixture} from './fixtures/admission-fixture.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../experimental/runtime-control/src/protocol.mjs';
import {createReceiver} from '../experimental/runtime-control/src/receiver.mjs';
import {createDispatcher} from '../experimental/runtime-control/src/dispatcher.mjs';
test('synthetic signed Board work traverses the real receiver and dispatcher for two tasks once each',async t=>{
 const f=await fixture(t),ownerId=f.catalogue.ownerId,enrollmentId=f.catalogue.enrollmentId,config={keyId:'fixture',secret:'SYNTHETIC_SECRET_ONLY_01234567890123456789',ownerId,allowedTaskId:f.catalogue.taskId,assistantId:f.catalogue.assistantId,admissionReusableBoardEnabled:true},ids=[],seen=new Set();let calls=0;
 const ready=()=>({acceptingRequests:true,pendingUncertainty:false,costContradiction:false});
 const adapter={kind:'groq-finite-admission',assistantId:config.assistantId,localTestOnly:false,reusableBoardEnabled:true,ready:true,permitsBoardTask:x=>x.ownerId===ownerId&&typeof x.taskId==='string',registerSignedWork:async p=>f.store.commitReusableFixture({payload:p,ownerId,enrollmentId,approvedInputSha256:await digest(canonical({requestText:p.request.text,taskContext:p.context})),currentAvailability:ready}),acceptsWorkScope:p=>f.store.get(p.eventId)?.payload_json===canonical(p),async answer(input){assert(!seen.has(input.requestId));seen.add(input.requestId);calls++;return {owner:input.owner,task:input.task,requestId:input.requestId,attempt:input.attempt,eventId:'resp:'+input.requestId,kind:'answer',outcomeKind:'information',body:'Synthetic review result.',statusChange:null};}};
 const receiver=createReceiver({store:f.store.relay,config,assistantAdapter:adapter});
 async function exchange(payload){const signed=await signRequest('https://fixture.invalid/bridge/v1',{v:1,action:'exchange',ownerId,payload},config),response=await receiver(signed.request);return {status:response.status,body:await verifyResponse(response,signed.nonce,config)};}
 const store={...f.store.relay,claimNext:input=>f.store.claimEligible({...input,ids})},board={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId},dispatcher=createDispatcher({store,boardAdapter:board,assistantAdapter:adapter,enabled:true,production:false,now:f.now,workerId:'fixture',claimTtlMs:60000});
 for(const taskId of ['fixture-task','other-task']){const requestId=randomUUID(),grantId=randomUUID(),eventId=await digest(canonical([ownerId,taskId,requestId])),at=f.now(),p={v:1,eventId,ownerId,taskId,requestId,grantId,assistantId:config.assistantId,grantExpiresAt:at+60000,request:{text:'Review this synthetic request.',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Fixture',nextAction:'Review',latestFinding:'Synthetic'}};p.payloadHash=await payloadHash(p);ids.push(eventId);assert.equal((await exchange(p)).body.state,'queued');assert.equal((await dispatcher.runOnce()).status,'completed');assert.equal((await exchange(p)).body.state,'completed');}
 assert.equal(calls,2);f.restart();assert.equal(f.store.hasEnrollmentUncertainty(enrollmentId),false);
});
