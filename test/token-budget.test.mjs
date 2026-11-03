import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures/admission-fixture.mjs';
import {createGroqAdapter} from '../experimental/runtime-control/src/groq-adapter.mjs';
import {validateReusableBoardAttestation} from '../experimental/runtime-control/src/admission-plan.mjs';
import {canonical,digest,payloadHash} from '../experimental/runtime-control/src/protocol.mjs';

test('legacy requests stay at 512; explicitly scoped new requests use 4096',async t=>{
 const f=await fixture(t),slot=f.entry.slots[0],at=f.now();let sent=[];
 const fetchImpl=async(_url,options)=>{sent.push(JSON.parse(options.body));return new Response(JSON.stringify({id:'synthetic',model:f.enrollment.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic answer.'}}]}));};
 const gate={v:3,provider:'groq',model:f.enrollment.model,harmlessTestOnly:true,maxCalls:1,owner:f.catalogue.ownerId,task:f.catalogue.taskId,requestId:slot.eventId,inputSha256:f.entry.inputSha256,enrollmentId:f.catalogue.enrollmentId,costEnrollment:f.enrollment,requestIssuedAt:at,requestExpiresAt:at+60000};
 const input={owner:gate.owner,task:gate.task,requestId:slot.eventId,invocationId:slot.eventId,attempt:1,requestText:f.entry.requestText,context:{taskContext:f.entry.taskContext}};
 for(const [cap,expected] of [[undefined,512],[4096,4096]]){const adapter=createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate:{...gate,...(cap?{maxCompletionTokens:cap}:{})},fetchImpl,now:f.now});assert.equal(adapter.ready,true);await adapter.answer(input);assert.equal(sent.at(-1).max_completion_tokens,expected);assert.equal(sent.at(-1).tool_choice,'none');}
 for(const cap of [0,512,1024,4097,'4096',null])assert.equal(createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate:{...gate,maxCompletionTokens:cap},fetchImpl,now:f.now}).ready,false);
 assert.equal(sent.length,2);
});

test('signed approval binds the new cap and rejects unapproved values',async t=>{
 const f=await fixture(t),s=f.entry.slots[0],at=f.now(),p={v:1,eventId:s.eventId,ownerId:f.catalogue.ownerId,taskId:f.catalogue.taskId,requestId:s.requestId,grantId:s.grantId,assistantId:f.catalogue.assistantId,grantExpiresAt:at+60000,request:{text:f.entry.requestText,createdAt:new Date(at).toISOString(),answerTo:null},context:f.entry.taskContext};p.payloadHash=await payloadHash(p);
 const a={v:1,purpose:f.entry.purpose,enrollmentId:f.catalogue.enrollmentId,inputSha256:await digest(canonical({requestText:p.request.text,taskContext:p.context})),issuedAt:at,expiresAt:p.grantExpiresAt};
 const args={payload:p,ownerId:p.ownerId,enrollmentId:a.enrollmentId,at};await validateReusableBoardAttestation({...args,approval:a});await validateReusableBoardAttestation({...args,approval:{...a,maxCompletionTokens:4096}});
 for(const cap of [0,512,4097,'4096',null])await assert.rejects(()=>validateReusableBoardAttestation({...args,approval:{...a,maxCompletionTokens:cap}}));
});

test('a truncated new response returns clearly labelled partial text, with no second call',async t=>{
 const f=await fixture(t),slot=f.entry.slots[0],at=f.now();let calls=0;
 const gate={v:3,provider:'groq',model:f.enrollment.model,harmlessTestOnly:true,maxCalls:1,owner:f.catalogue.ownerId,task:f.catalogue.taskId,requestId:slot.eventId,inputSha256:f.entry.inputSha256,enrollmentId:f.catalogue.enrollmentId,costEnrollment:f.enrollment,requestIssuedAt:at,requestExpiresAt:at+60000,maxCompletionTokens:4096};
 const input={owner:gate.owner,task:gate.task,requestId:slot.eventId,invocationId:slot.eventId,attempt:1,requestText:f.entry.requestText,context:{taskContext:f.entry.taskContext}};
 const adapter=createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate,now:f.now,fetchImpl:async()=>{calls++;return new Response(JSON.stringify({id:'synthetic',model:f.enrollment.model,choices:[{finish_reason:'length',message:{role:'assistant',content:'x'.repeat(5000)}}]}));}});
 const partial=await adapter.answer(input);assert.match(partial.body,/Incomplete response/);assert.ok(partial.body.endsWith('x'.repeat(5000)));
 await assert.rejects(()=>adapter.answer(input));assert.equal(calls,1);
});

test('long completed answers are accepted and oversized responses are bounded',async t=>{
 const f=await fixture(t),slot=f.entry.slots[0],at=f.now();
 const gate={v:3,provider:'groq',model:f.enrollment.model,harmlessTestOnly:true,maxCalls:1,owner:f.catalogue.ownerId,task:f.catalogue.taskId,requestId:slot.eventId,inputSha256:f.entry.inputSha256,enrollmentId:f.catalogue.enrollmentId,costEnrollment:f.enrollment,requestIssuedAt:at,requestExpiresAt:at+60000,maxCompletionTokens:4096};
 const input={owner:gate.owner,task:gate.task,requestId:slot.eventId,invocationId:slot.eventId,attempt:1,requestText:f.entry.requestText,context:{taskContext:f.entry.taskContext}};
 const create=content=>createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate,now:f.now,fetchImpl:async()=>new Response(JSON.stringify({id:'synthetic',model:f.enrollment.model,choices:[{finish_reason:'stop',message:{role:'assistant',content}}]}))});
 const long='A'+String.fromCharCode(1).repeat(15898)+'Z';const result=await create(long).answer(input);assert.ok(result.body.endsWith(long));
 await assert.rejects(()=>create('x'.repeat(15901)).answer(input),e=>e.code==='groq_outcome_uncertain');
 const tooLarge=createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate,now:f.now,fetchImpl:async()=>new Response('x'.repeat(131073))});
 await assert.rejects(()=>tooLarge.answer(input),e=>e.code==='groq_outcome_uncertain');
});

test('a truncated response with no visible text remains incomplete, and old grants retain their behavior',async t=>{
 const f=await fixture(t),slot=f.entry.slots[0],at=f.now();
 const gate={v:3,provider:'groq',model:f.enrollment.model,harmlessTestOnly:true,maxCalls:1,owner:f.catalogue.ownerId,task:f.catalogue.taskId,requestId:slot.eventId,inputSha256:f.entry.inputSha256,enrollmentId:f.catalogue.enrollmentId,costEnrollment:f.enrollment,requestIssuedAt:at,requestExpiresAt:at+60000};
 const input={owner:gate.owner,task:gate.task,requestId:slot.eventId,invocationId:slot.eventId,attempt:1,requestText:f.entry.requestText,context:{taskContext:f.entry.taskContext}};
 for(const [g,content] of [[{...gate,maxCompletionTokens:4096},''],[gate,'previous partial text']]){
  const adapter=createGroqAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate:g,now:f.now,fetchImpl:async()=>new Response(JSON.stringify({id:'synthetic',model:f.enrollment.model,choices:[{finish_reason:'length',message:{role:'assistant',content}}]}))});
  await assert.rejects(()=>adapter.answer(input),e=>e.code==='groq_output_incomplete');
 }
});
