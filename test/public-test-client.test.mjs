import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublicTestClient} from '../examples/landing/public-test.mjs';
import {SAMPLE_REQUEST} from '../examples/landing/learning-guide.mjs';
import {PUBLIC_TEST_INPUT_SHA} from '../experimental/runtime-control/src/admission-store.mjs';
const id='00000000-0000-4000-8000-000000000001';
const status={v:1,requestText:SAMPLE_REQUEST,inputSha256:PUBLIC_TEST_INPUT_SHA,provider:'Groq',model:'openai/gpt-oss-20b',maxOutputTokens:512,tools:false,retries:0,paidFallback:false,remaining:8,ready:true};
test('visiting makes no call; exact explicit submission happens once and lost response only permits result reads',async()=>{
 const calls=[];const c=createPublicTestClient({makeId:()=>id,fetchImpl:async(url,options)=>{calls.push({url,options});if(options.method==='POST')throw Error('lost response');return Response.json(url.endsWith('status')?status:{state:'completed',resultAvailable:true,answer:'saved'});}});
 assert.equal(calls.length,0);await assert.rejects(c.submit(),/review_required/);
 await c.availability();await assert.rejects(c.submit(),/lost response/);assert.equal(c.requestId,id);
 await assert.rejects(c.submit(),/review_required/);assert.equal((await c.result()).answer,'saved');
 assert.equal(calls.filter(x=>x.options.method==='POST').length,1);
 for(const {options}of calls){assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');}
 assert.deepEqual(JSON.parse(calls.find(x=>x.options.method==='POST').options.body),{requestId:id,inputSha256:PUBLIC_TEST_INPUT_SHA,approve:true});
});
test('restored results need no fresh model submission and changed provider policy is refused',async()=>{
 const c=createPublicTestClient({fetchImpl:async()=>Response.json({...status,maxOutputTokens:4096})});await assert.rejects(c.availability(),/unexpected_public_policy/);
 c.restore('not-an-id');assert.equal(c.requestId,null);c.restore(id);assert.equal(c.requestId,id);await assert.rejects(c.submit(),/review_required/);c.reset();assert.equal(c.requestId,null);
});
