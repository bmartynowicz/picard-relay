import assert from 'node:assert/strict';
import {createRelayStore} from '../src/relay-store.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
const config={allowedTaskId:'task',ownerId:'owner',assistantId:'groq:openai/gpt-oss-20b',keyId:'fixture',secret:'SYNTHETIC_ONLY_NOT_CREDENTIAL_1234567890'};
const at=Date.now();const store=createRelayStore({dbPath:':memory:'});
const adapter={ready:true,assistantId:config.assistantId,kind:'explicit-fixture'};
const receiver=createReceiver({store,config,assistantAdapter:adapter});
async function work(message){const p={v:1,eventId:await digest(canonical(['owner','task',message])),ownerId:'owner',taskId:'task',requestId:message,grantId:'grant',assistantId:config.assistantId,grantExpiresAt:at+600000,request:{text:'Reply Hello World',createdAt:new Date(at).toISOString(),answerTo:null},context:{title:'Relay Hello World verification',nextAction:'',latestFinding:''}};p.payloadHash=await payloadHash(p);return p;}
async function exchange(p){const s=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'exchange',ownerId:'owner',payload:p},config);const response=await receiver(s.request);return {status:response.status,value:await verifyResponse(response,s.nonce,config)};}
try{
 const p=await work('one');assert.equal((await exchange(p)).value.state,'queued');
 const claim=store.claimNext({workerId:'test',claimTtlMs:60000});const owned={requestId:p.eventId,attempt:claim.attempt,workerId:'test'};store.startInvocation(owned);store.appendReply({...owned,owner:'owner',task:'task',eventId:'resp:'+p.eventId,kind:'answer',outcomeKind:'information',statusChange:null,body:'hello'});store.markCompleted(owned);
 adapter.ready=false;
 const saved=await exchange(p);assert.equal(saved.status,200);assert.equal(saved.value.state,'completed');assert.equal(saved.value.result.body,'hello');console.log('PASS authenticated saved result remains retrievable after provider allowance consumed');
 assert.equal((await exchange(await work('two'))).status,503);assert.equal(store.stats().reduce((n,r)=>n+r.count,0),1);console.log('PASS new request still blocked without provider allowance');
 const altered=structuredClone(p);altered.request.text='changed';altered.payloadHash=await payloadHash(altered);assert.equal((await exchange(altered)).status,403);console.log('PASS altered replay still rejected');
 const wrong=structuredClone(p);wrong.assistantId='other';wrong.payloadHash=await payloadHash(wrong);assert.equal((await exchange(wrong)).status,403);console.log('PASS wrong assistant still rejected');

 async function lookup(input){const signed=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'result',ownerId:'owner',taskId:'task',eventId:p.eventId,payloadHash:p.payloadHash,...input},config);const response=await receiver(signed.request);return {status:response.status,value:await verifyResponse(response,signed.nonce,config)};}
 const retrieved=await lookup({});assert.equal(retrieved.status,200);assert.equal(retrieved.value.result.body,'hello');console.log('PASS result-only lookup returns completed reply without exporting task content');
 assert.equal((await lookup({taskId:'wrong'})).status,403);assert.equal((await lookup({payloadHash:'0'.repeat(64)})).status,403);console.log('PASS result-only lookup rejects wrong task and payload hash');

 for(const changes of [{taskId:'other'},{request:{...p.request,text:'private question'}},{request:{...p.request,answerTo:'question-id'}},{context:{...p.context,latestFinding:'private finding'}},{context:{...p.context,title:'Private task'}}]){const outside={...p,...changes};outside.payloadHash=await payloadHash(outside);assert.equal((await exchange(outside)).status,403);}
 console.log('PASS receiver denies other task, text, linked answers and private context');
 const noScope=createReceiver({store,config:{...config,allowedTaskId:''},assistantAdapter:adapter});const missing=await signRequest('https://relay.invalid/bridge/v1',{v:1,action:'health',ownerId:'owner'},config);assert.equal((await noScope(missing.request)).status,403);console.log('PASS Groq receiver fails closed without configured task scope');
 store.cancel('owner','task','grant');const cancelled=await lookup({});assert.notEqual(cancelled.status,200);assert.equal(cancelled.value.result,undefined);console.log('PASS revoked grant prevents result-only retrieval');
}finally{store.close();}
