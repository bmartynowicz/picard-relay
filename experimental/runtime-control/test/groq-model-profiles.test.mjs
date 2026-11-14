import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {groqReviewProfile,groqReviewProfileDigest,validCostEnrollmentMetadata} from '../src/admission-enrollment.mjs';
import {createGroqAdapter,inputDigest,costEnrollmentDigest} from '../src/groq-adapter.mjs';
import {createGroqOnceAdapter} from '../src/groq-once-adapter.mjs';
import {sanitizeProviderUsage} from '../src/adapters.mjs';
const at=1800000000000,key='SYNTHETIC_MODEL_TEST_KEY_ONLY',qwen='qwen/qwen3.8-27b';
const sha=x=>createHash('sha256').update(x).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(model=qwen){
 const profile=groqReviewProfile(model,{alternateModelsEnabled:true});
 const context={title:'Synthetic model contract',nextAction:'Review only',latestFinding:'Synthetic public text.'};
 const input={owner:'synthetic-owner',task:'synthetic-task',requestId:'a'.repeat(64),invocationId:'a'.repeat(64),attempt:1,requestText:'Return a plain-text proposal; no actions.',context:{grantId:'synthetic-grant',taskContext:context}};
 const enrollment={v:2,provider:'groq',model,owner:input.owner,accountLabel:'SYNTHETIC_FREE_PROJECT',organizationId:'synthetic-org',projectId:'synthetic-project',keySha256:sha(key),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-2000,enrolledAt:at-1000,evidenceRef:'SYNTHETIC_ACCOUNT_EVIDENCE',keyAssociationEvidenceRef:'SYNTHETIC_KEY_ASSOCIATION',modelProfileSha256:groqReviewProfileDigest(profile)};
 const gate={v:3,purpose:'public-source-review',provider:'groq',model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,maxCompletionTokens:4096,owner:input.owner,task:input.task,requestId:input.requestId,inputSha256:inputDigest(input),grantId:input.context.grantId,eventId:input.requestId,approvedRequestText:input.requestText,taskContext:context,approvedInputSha256:inputDigest(input),enrollmentId:costEnrollmentDigest(enrollment),costEnrollment:enrollment,requestIssuedAt:at-10,requestExpiresAt:at+60000};
 return {input,gate,profile};
}
function response(model=qwen,{content='Synthetic reviewed proposal.',finish='stop',tools}={}){return new Response(JSON.stringify({id:'synthetic-response',model,choices:[{finish_reason:finish,message:{role:'assistant',content,...(tools?{tool_calls:tools}:{})}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));}
function adapter(f,options={}){const model=f.gate.model;return createGroqAdapter({enabled:true,apiKey:key,gate:f.gate,model,alternateModelsEnabled:true,now:()=>at,fetchImpl:async()=>response(model),...options});}
test('alternate profiles require explicit opt-in and reject guessed aliases or endpoints',()=>{
 assert.equal(groqReviewProfile(qwen),null);assert.equal(groqReviewProfile('openai/gpt-oss-120b'),null);
 for(const name of ['qwen3.8-flash','qwen3.8-27b','nvidia/Nemotron-Flash-1B','https://example.org',qwen+' '])assert.equal(groqReviewProfile(name,{alternateModelsEnabled:true}),null);
 const p=groqReviewProfile(qwen,{alternateModelsEnabled:true});assert.ok(Object.isFrozen(p)&&Object.isFrozen(p.parameters));assert.equal(p.endpoint,'https://api.groq.com/openai/v1/chat/completions');
});
test('new enrollment binds exact profile; original Free enrollment cannot authorize another model',()=>{
 const f=fixture();assert.equal(validCostEnrollmentMetadata(f.gate.costEnrollment),false);assert.equal(validCostEnrollmentMetadata(f.gate.costEnrollment,{alternateModelsEnabled:true}),true);
 for(const change of [{v:1},{model:'openai/gpt-oss-120b'},{modelProfileSha256:'f'.repeat(64)},{endpoint:'https://example.org'},{accountPlan:'Developer'},{noPaidFallback:false}])assert.equal(validCostEnrollmentMetadata({...f.gate.costEnrollment,...change},{alternateModelsEnabled:true}),false);
});
for(const model of [qwen,'openai/gpt-oss-120b'])test(model+' sends one exact fixed-endpoint inert request and retains model-specific usage',async()=>{
 const f=fixture(model);let calls=0;
 const a=adapter(f,{fetchImpl:async(url,o)=>{calls++;const b=JSON.parse(o.body);assert.equal(url,f.profile.endpoint);assert.equal(o.redirect,'error');assert.equal(b.model,model);assert.equal(b.reasoning_effort,'low');assert.equal(b.reasoning_format,'hidden');assert.equal(b.max_completion_tokens,4096);assert.equal(b.tool_choice,'none');assert.equal(b.stream,false);assert.equal(b.n,1);assert.ok(b.messages[0].content.includes(model));assert.ok(!b.messages[0].content.includes('GPT-OSS-20B'));return response(model);}});
 assert.equal(a.assistantId,'groq:'+model);const result=await a.answer(f.input);assert.equal(result.providerUsage.model,model);assert.equal(result.providerUsage.totalTokens,30);assert.ok(result.body.startsWith('[Groq / '+model+']'));
 await assert.rejects(()=>a.answer(f.input));assert.equal(calls,1);
});
test('default-off, cross-model grants, profile substitutions and changed inputs stop before I/O',async()=>{
 const f=fixture();let calls=0;const fetchImpl=async()=>{calls++;return response();};
 const bad=[adapter(f,{alternateModelsEnabled:false,fetchImpl}),adapter(f,{model:'openai/gpt-oss-20b',fetchImpl}),adapter(f,{gate:{...f.gate,enrollmentId:'f'.repeat(64)},fetchImpl})];
 for(const a of bad){assert.equal(a.ready,false);await assert.rejects(()=>a.answer(f.input));}
 for(const change of [{owner:'other'},{task:'other'},{requestText:'different'},{invocationId:'b'.repeat(64)}])await assert.rejects(()=>adapter(f,{fetchImpl}).answer({...f.input,...change}));
 assert.equal(calls,0);
});
test('caller mutations cannot widen the already constructed approval',async()=>{
 const f=fixture();const a=adapter(f);f.gate.model='openai/gpt-oss-120b';f.gate.costEnrollment.model='openai/gpt-oss-120b';f.gate.maxCompletionTokens=99999;
 assert.equal(a.ready,true);const result=await a.answer(f.input);assert.equal(result.providerUsage.model,qwen);
});
for(const kind of ['wrong-model','tools','http-429','http-402','network','malformed'])test(kind+' stops without retry or model fallback',async()=>{
 const f=fixture();let calls=0;const a=adapter(f,{fetchImpl:async()=>{calls++;if(kind==='network')throw Error('synthetic secret must not escape');if(kind==='malformed')return new Response('{');if(kind.startsWith('http-'))return new Response('',{status:Number(kind.slice(5))});if(kind==='tools')return response(qwen,{tools:[{id:'unexpected'}]});return response('openai/gpt-oss-20b');}});
 await assert.rejects(()=>a.answer(f.input));await assert.rejects(()=>a.answer(f.input));assert.equal(calls,1);
});
test('usage identity never accepts absent or guessed model IDs',()=>{
 for(const model of [undefined,'qwen3.8-flash','unknown'])assert.equal(sanitizeProviderUsage({v:1,provider:'groq',model,inputTokens:1,outputTokens:1,totalTokens:2}),null);
});
test('real private durable marker is consumed before alternate-model I/O and survives restart',{skip:process.platform!=='linux'},async()=>{
 const f=fixture(),dir=mkdtempSync(join(tmpdir(),'picard-model-profile-'));chmodSync(dir,0o700);const markerPath=join(dir,'consumed.json');let calls=0;
 try{
  const create=()=>createGroqOnceAdapter({enabled:true,alternateModelsEnabled:true,model:qwen,apiKey:key,gate:f.gate,markerPath,now:()=>at,fetchImpl:async()=>{calls++;assert.equal(JSON.parse(readFileSync(markerPath)).model,qwen);return response();}});
  const a=create(),b=create();assert.equal(a.ready,true);assert.equal(a.assistantId,'groq:'+qwen);
  const results=await Promise.allSettled([a.answer(f.input),b.answer(f.input)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls,1);assert.ok(existsSync(markerPath));assert.equal(create().ready,false);await assert.rejects(()=>create().answer(f.input));assert.equal(calls,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
