// Independent offline review regressions; no network provider calls.
import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createGroqOnceAdapter} from '../experimental/runtime-control/src/groq-once-adapter.mjs';
import {createFreeOnlyRoutingAdapter} from '../experimental/runtime-control/src/selected-assistant.mjs';
import {inputDigest,GROQ_ID,GROQ_MODEL} from '../experimental/runtime-control/src/groq-adapter.mjs';
import {canonical,digest,payloadHash} from '../experimental/runtime-control/src/protocol.mjs';
import {createRelayStore} from '../experimental/runtime-control/src/relay-store.mjs';
import {createDispatcher} from '../experimental/runtime-control/src/dispatcher.mjs';
async function scenario(oldGrant){
const dir=mkdtempSync(join(tmpdir(),'picard-grant-review-'));const at=Date.now();let calls=0;
const text='Review this public function: export const add=(a,b)=>a+b;',context={title:'Public source review',nextAction:'',latestFinding:''};
const eventId=await digest(canonical(['owner','task','message']));
const gate={v:2,purpose:'public-source-review',provider:'groq',model:GROQ_MODEL,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,evidenceRef:'offline-fixture',owner:'owner',task:'task',eventId,grantId:'NEW_APPROVED_GRANT',approvedRequestText:text,taskContext:context,approvedInputSha256:inputDigest({requestText:text,context:{taskContext:context}}),verifiedAt:at-1,validUntil:at+60000};
const rawAdapter=createGroqOnceAdapter({enabled:true,apiKey:'offline-fixture',gate,markerPath:join(dir,'marker.json'),fetchImpl:async()=>{calls++;return new Response(JSON.stringify({id:'offline',model:GROQ_MODEL,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Offline fixture'}}]}),{status:200});}});
const payload={v:1,eventId,ownerId:'owner',taskId:'task',requestId:'message',grantId:oldGrant,assistantId:GROQ_ID,grantExpiresAt:at+60000,request:{text,createdAt:new Date(at).toISOString(),answerTo:null},context};payload.payloadHash=await payloadHash(payload);
const store=createRelayStore({dbPath:':memory:'});
try{
 const ingressAccepted=rawAdapter.acceptsWorkScope(payload);
 await store.accept(payload); // Previously admitted durable queue, before v2 gate enrollment.
 const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter:createFreeOnlyRoutingAdapter(rawAdapter),enabled:true,production:false});
 const result=await dispatcher.runOnce();
 const replay=await dispatcher.runOnce();
 const restarted=createGroqOnceAdapter({enabled:true,apiKey:'offline-fixture',gate,markerPath:join(dir,'marker.json'),fetchImpl:async()=>{throw Error('unexpected transport');}});
 return {status:result.status,calls,ingressAccepted,replay:replay.status,restartedReady:restarted.ready,canServeResults:restarted.canServeResults,row:store.get(eventId).state};
}finally{store.close();rmSync(dir,{recursive:true,force:true});}

}
test("stale queued row cannot consume newly pinned different grant",async()=>{const r=await scenario("OLD_OTHER_GRANT");assert.equal(r.ingressAccepted,false);assert.equal(r.status,"blocked");assert.equal(r.calls,0);assert.equal(r.row,"blocked");assert.equal(r.restartedReady,true);});
test("exact persisted grant succeeds once and remains spent after reconstruction",async()=>{const r=await scenario("NEW_APPROVED_GRANT");assert.equal(r.ingressAccepted,true);assert.equal(r.status,"completed");assert.equal(r.calls,1);assert.equal(r.replay,"idle");assert.equal(r.restartedReady,false);assert.equal(r.canServeResults,true);});
