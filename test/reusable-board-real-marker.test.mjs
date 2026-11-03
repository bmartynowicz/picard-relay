import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixtures/admission-fixture.mjs';
import {createGroqOnceAdapter} from '../experimental/runtime-control/src/groq-once-adapter.mjs';

test('real per-grant markers preserve an uncertain call without blocking a distinct grant', {skip:process.platform!=='linux'?'Requires Linux private directory semantics.':false}, async t=>{
 const f=await fixture(t),[first,second]=f.entry.slots; let calls=0;
 const fetchImpl=async()=>{calls++;if(calls===1)throw Error('synthetic transport failure');return new Response(JSON.stringify({id:'synthetic',model:f.enrollment.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic answer.'}}]}));};
 function make(slot){
  const gate={v:3,purpose:f.entry.purpose,provider:'groq',model:f.enrollment.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:f.catalogue.ownerId,task:f.catalogue.taskId,grantId:slot.grantId,eventId:slot.eventId,approvedRequestText:f.entry.requestText,taskContext:f.entry.taskContext,approvedInputSha256:f.entry.inputSha256,enrollmentId:f.catalogue.enrollmentId,costEnrollment:f.enrollment,requestIssuedAt:f.now(),requestExpiresAt:f.now()+60000};
  const markerPath=join(f.dir,'groq-once-'+slot.grantId+'.consumed');
  const adapter=createGroqOnceAdapter({enabled:true,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',gate,markerPath,fetchImpl,now:f.now,perGrantCostLatch:true});
  const input={owner:gate.owner,task:gate.task,requestId:slot.eventId,invocationId:slot.eventId,attempt:1,requestText:gate.approvedRequestText,context:{grantId:slot.grantId,taskContext:gate.taskContext}};
  return {adapter,input,markerPath};
 }
 const a=make(first),b=make(second);assert.equal(a.adapter.ready,true);await assert.rejects(()=>a.adapter.answer(a.input));
 assert.equal(existsSync(a.markerPath),true);assert.equal(existsSync(a.markerPath+'.pending'),true);assert.equal(make(first).adapter.ready,false);
 assert.equal(b.adapter.ready,true);await b.adapter.answer(b.input);assert.equal(calls,2);assert.equal(existsSync(b.markerPath),true);assert.equal(existsSync(b.markerPath+'.pending'),false);
 assert.equal(make(first).adapter.ready,false);
});
