import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {startOracleService} from '../src/oracle-service.mjs';import {createRelayStore} from '../src/relay-store.mjs';import {createReceiver} from '../src/receiver.mjs';import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
const dir=mkdtempSync(join(tmpdir(),'picard-drain-')),dbPath=join(dir,'ledger.sqlite');
const config={enabled:true,dbPath,port:0,ownerId:'owner',assistantId:'groq:openai/gpt-oss-20b',allowedTaskId:'task',keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};
async function work(message){const at=Date.now(),p={v:1,eventId:await digest(canonical(['owner','task',message])),ownerId:'owner',taskId:'task',requestId:message,grantId:'grant',assistantId:config.assistantId,grantExpiresAt:at+600000,request:{text:'Reply Hello World',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Relay Hello World verification',nextAction:'',latestFinding:''}};p.payloadHash=await payloadHash(p);return p;}
let calls=0,startedResolve,finishResolve;const started=new Promise(r=>startedResolve=r),finish=new Promise(r=>finishResolve=r);
const adapter={ready:true,assistantId:config.assistantId,kind:'local-integration-fixture',async answer(input){calls++;startedResolve();await finish;return {...input,kind:'answer',outcomeKind:'information',body:'fixture response',statusChange:null,eventId:'resp:'+input.requestId};}};
let runtime;
try{
 const first=await work('first'),second=await work('second');const seed=createRelayStore(config);await seed.accept(first);await seed.accept(second);seed.close();
 runtime=await startOracleService(config,adapter,{intervalMs:5});await started;
 const h=runtime.control.drain();assert.equal(h.busy,true);assert.equal(h.drained,false);assert.equal(h.unresolvedInvoking,1);
 process.emit('SIGTERM');let stopped=false;const stopping=runtime.shutdown().then(()=>stopped=true);await new Promise(r=>setTimeout(r,20));assert.equal(stopped,false);assert.equal(calls,1);
 finishResolve();await stopping;assert.equal(calls,1);
 const store=createRelayStore({...config,canAccept:()=>false});assert.equal(store.get(first.eventId).state,'completed');assert.equal(store.get(second.eventId).state,'queued');
 const receiver=createReceiver({store,config,assistantAdapter:adapter,canAccept:()=>false});
 const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'result',ownerId:'owner',taskId:'task',eventId:first.eventId,payloadHash:first.payloadHash},config);const response=await receiver(signed.request);assert.equal((await verifyResponse(response,signed.nonce,config)).result.body,'fixture response');
 const third=await work('third');await assert.rejects(store.accept(third),/relay_draining/);assert.equal(store.get(third.eventId),null);store.close();
 console.log('PASS real service lifecycle: busy drain + SIGTERM waits, one fixture invocation, queued work retained, signed result readable, new durable admission denied');
}finally{finishResolve();if(runtime)await runtime.shutdown();rmSync(dir,{recursive:true,force:true});}
