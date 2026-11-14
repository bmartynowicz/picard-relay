import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,writeFileSync,readFileSync,rmSync,unlinkSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {inspectModelPilot,runModelPilot,readModelPilotResult} from '../tools/groq-model-pilot.mjs';
import {groqReviewProfile,groqReviewProfileDigest} from '../experimental/runtime-control/src/admission-enrollment.mjs';
import {costEnrollmentDigest,inputDigest} from '../experimental/runtime-control/src/groq-adapter.mjs';
const linux={skip:process.platform!=='linux'},at=1800000000000,model='qwen/qwen3.8-27b',key='SYNTHETIC_MODEL_PILOT_KEY_ONLY';
const sha=s=>createHash('sha256').update(s).digest('hex');
function ownAsRoot(file){if(process.getuid()!==0)execFileSync('sudo',['-n','chown','0:'+process.getgid(),file]);}
function setup(t){
 const dir=mkdtempSync(join(tmpdir(),'picard-model-pilot-'));chmodSync(dir,0o700);t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const gateFile=join(dir,'gate.json'),keyFile=join(dir,'key'),context={title:'Synthetic public task',nextAction:'Review only',latestFinding:'Synthetic data.'};
 const input={requestText:'Return a synthetic plain-text proposal.',context:{taskContext:context}};
 const e={v:2,provider:'groq',model,owner:'synthetic-owner',accountLabel:'SYNTHETIC_FREE_ACCOUNT',organizationId:'synthetic-org',projectId:'synthetic-project',keySha256:sha(key),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-2000,enrolledAt:at-1000,evidenceRef:'SYNTHETIC_ACCOUNT_EVIDENCE',keyAssociationEvidenceRef:'SYNTHETIC_KEY_ASSOCIATION',modelProfileSha256:groqReviewProfileDigest(groqReviewProfile(model,{alternateModelsEnabled:true}))};
 const gate={v:3,purpose:'public-source-review',provider:'groq',model,owner:e.owner,task:'synthetic-task',grantId:'synthetic-grant',eventId:'a'.repeat(64),approvedRequestText:input.requestText,taskContext:context,approvedInputSha256:inputDigest(input),costEnrollment:e,enrollmentId:costEnrollmentDigest(e),requestIssuedAt:at-10,requestExpiresAt:at+60000,maxCalls:1,maxCompletionTokens:4096,harmlessTestOnly:true,accountPlan:'Free',noPaidFallback:true,markerDirectory:dir};
 const saveGate=()=>{writeFileSync(gateFile,JSON.stringify(gate),{mode:0o640});chmodSync(gateFile,0o640);ownAsRoot(gateFile);};saveGate();writeFileSync(keyFile,key,{mode:0o640});ownAsRoot(keyFile);
 return {dir,gateFile,keyFile,gate,saveGate,options:{gateFile,keyFile,enabled:true,now:()=>at},marker:join(dir,'groq-model-pilot-'+gate.eventId+'.consumed')};
}
const reply=()=>new Response(JSON.stringify({id:'synthetic-model-response',model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic proposal; no action performed.'}}],usage:{prompt_tokens:11,completion_tokens:7,total_tokens:18}}));
test('pilot is disabled by default before reading any operator files',async()=>{await assert.rejects(()=>runModelPilot());});
test('actual protected approval, durable one-use request and private saved-result recovery',linux,async t=>{
 const f=setup(t);let calls=0;assert.equal(inspectModelPilot(f.gateFile,{now:()=>at}).profile.model,model);
 const fetchImpl=async(url,o)=>{calls++;assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');assert.equal(JSON.parse(o.body).model,model);assert.equal(JSON.parse(readFileSync(f.marker)).state,'consumed-before-io');return reply();};
 const result=await runModelPilot({...f.options,fetchImpl});assert.equal(result.providerUsage.totalTokens,18);assert.equal(calls,1);
 await assert.rejects(()=>runModelPilot({...f.options,fetchImpl}));assert.equal(calls,1);const saved=readModelPilotResult(result.resultFile);assert.equal(saved.model,model);assert.equal(saved.answer.providerUsage.model,model);
});
test('simultaneous processes sharing the approved event cannot consume two calls',linux,async t=>{
 const f=setup(t);let calls=0;const fetchImpl=async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,10));return reply();};
 const results=await Promise.allSettled([runModelPilot({...f.options,fetchImpl}),runModelPilot({...f.options,fetchImpl})]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(calls,1);
});
test('uncertain transport keeps its consumed marker and blocks replay',linux,async t=>{
 const f=setup(t);let calls=0;const fetchImpl=async()=>{calls++;throw Error('SYNTHETIC_UNCERTAINTY');};
 await assert.rejects(()=>runModelPilot({...f.options,fetchImpl}));assert.ok(existsSync(f.marker));await assert.rejects(()=>runModelPilot({...f.options,fetchImpl}));assert.equal(calls,1);
});
test('wrong key and redirected protected file stop before provider I/O',linux,async t=>{
 const f=setup(t);let calls=0;const fetchImpl=async()=>{calls++;return reply();};
 const wrong=join(f.dir,'wrong-key');writeFileSync(wrong,'SYNTHETIC_WRONG_KEY',{mode:0o640});ownAsRoot(wrong);await assert.rejects(()=>runModelPilot({...f.options,keyFile:wrong,fetchImpl}));
 const link=join(f.dir,'gate-link');symlinkSync(f.gateFile,link);await assert.rejects(()=>runModelPilot({...f.options,gateFile:link,fetchImpl}));assert.equal(calls,0);assert.equal(existsSync(f.marker),false);
});
test('caller cannot reset the allowance with another marker option',linux,async t=>{
 const f=setup(t);let calls=0;const fetchImpl=async()=>{calls++;return reply();};await runModelPilot({...f.options,fetchImpl});
 await assert.rejects(()=>runModelPilot({...f.options,markerPath:join(f.dir,'another-marker'),fetchImpl}));assert.equal(calls,1);
});
test('an existing result prevents another call even if a marker was removed',linux,async t=>{
 const f=setup(t);let calls=0;const fetchImpl=async()=>{calls++;return reply();};const result=await runModelPilot({...f.options,fetchImpl});unlinkSync(f.marker);
 await assert.rejects(()=>runModelPilot({...f.options,fetchImpl}));assert.equal(calls,1);assert.equal(readModelPilotResult(result.resultFile).model,model);
});
