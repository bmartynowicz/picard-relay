import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture} from '../../../test/fixtures/workspace-fixture.mjs';
import {canonical,digest,payloadHash} from '../src/protocol.mjs';
import {groqReviewProfile,groqReviewProfileDigest} from '../src/admission-enrollment.mjs';
import {validateHistoricalModelProof} from '../src/admission-handler.mjs';
import {createHistoricalModelProofReader} from '../src/admission-runtime.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
async function setup(t,{proofsEnabled=true}={}){
 const proofs=new Map(),f=await workspaceFixture({preserveLegacyBaseline:true,readHistoricalModelProof:proofsEnabled?ref=>proofs.get(ref):null});t.after(()=>f.close());
 const d=await f.prepare();await f.submit(d,await f.approve(d));await f.dispatcher.runOnce();
 const original=f.store.get(d.payload.eventId),p=JSON.parse(original.payload_json),model='openai/gpt-oss-120b',at=f.now();
 p.requestId=randomUUID();p.grantId='model-evaluation-'+randomUUID();p.eventId=await digest(canonical([p.ownerId,p.taskId,p.requestId]));p.assistantId='groq:'+model;p.payloadHash=await payloadHash(p);
 const result={...JSON.parse(original.result_json),eventId:p.eventId,requestId:p.requestId,grantId:p.grantId,assistantId:p.assistantId,payloadHash:p.payloadHash,responseId:'resp:'+p.eventId,providerUsage:{v:1,provider:'groq',model,inputTokens:10,outputTokens:20,totalTokens:30}};
 const row={...original,event_id:p.eventId,message_id:p.requestId,grant_id:p.grantId,payload_hash:p.payloadHash,payload_json:canonical(p),result_json:canonical(result),response_id:result.responseId,updated_at:at};
 const fields=Object.keys(row),db=new DatabaseSync(f.dbPath);db.prepare('INSERT INTO relay_jobs('+fields.join(',')+') VALUES('+fields.map(()=>'?').join(',')+')').run(...fields.map(k=>row[k]));db.close();
 const issued=Date.parse(p.request.createdAt),e={v:2,provider:'groq',model,owner:p.ownerId,accountLabel:'SYNTHETIC',organizationId:'synthetic',projectId:'synthetic',keySha256:'a'.repeat(64),accountPlan:'Free',noPaidFallback:true,verifiedAt:issued-2000,enrolledAt:issued-1000,evidenceRef:'SYNTHETIC',keyAssociationEvidenceRef:'SYNTHETIC',modelProfileSha256:groqReviewProfileDigest(groqReviewProfile(model,{alternateModelsEnabled:true}))};
 const gate={v:3,provider:'groq',model,owner:p.ownerId,task:p.taskId,requestId:p.requestId,eventId:p.eventId,grantId:p.grantId,costEnrollment:e,enrollmentId:hash(canonical(e)),approvedRequestText:p.request.text,taskContext:p.context,approvedInputSha256:hash(canonical({requestText:p.request.text,taskContext:p.context})),requestIssuedAt:issued,requestExpiresAt:p.grantExpiresAt,maxCalls:1,maxCompletionTokens:4096,harmlessTestOnly:true,accountPlan:'Free',noPaidFallback:true,purpose:'sanitized-source-proposal'};
 const proof={v:1,gate,payloadSha256:hash(row.payload_json),resultSha256:hash(row.result_json)};proofs.set(p.eventId,proof);return {f,proofs,p,row,proof,at};
}
test('foreign-model completed result without independent proof fails closed',async t=>{
 const {f,p}=await setup(t,{proofsEnabled:false});assert.equal((await f.request('/workspace/requests/'+p.eventId)).status,409);assert.equal((await f.request('/workspace/config')).body.progress,null);assert.equal(f.calls,1);
});
test('original model proof recovers historical result and credit without clearing legacy guard or dispatching',async t=>{
 const {f,p,proofs}=await setup(t);const saved=await f.request('/workspace/requests/'+p.eventId);assert.equal(saved.status,200);assert.equal(saved.body.provenance.model,p.assistantId);assert.equal(saved.body.provenance.maxOutputTokens,4096);assert.equal(saved.body.provenance.source,'Operator-verified historical model result');
 const config=(await f.request('/workspace/config')).body;assert.deepEqual(config.progress,{v:2,completedWork:2,atLeast:false});assert.equal(config.ready,false);assert.equal(config.blockingCode,'legacy_review_required');
 f.restart();assert.equal((await f.request('/workspace/config')).body.progress.completedWork,2);assert.equal(f.calls,1);
 proofs.clear();assert.equal((await f.request('/workspace/config')).body.progress,null);assert.equal((await f.request('/workspace/requests/'+p.eventId)).status,409);assert.equal(f.calls,1);
});
for(const change of ['model','owner','task','requestId','eventId','grantId','approvedRequestText','approvedInputSha256','enrollmentId','maxCalls','maxCompletionTokens','noPaidFallback','purpose','requestIssuedAt','requestExpiresAt'])test('reject changed original gate '+change,async t=>{
 const {proof,p,row,f,at}=await setup(t);const bad=structuredClone(proof);bad.gate[change]=typeof bad.gate[change]==='number'?bad.gate[change]+1:typeof bad.gate[change]==='boolean'?!bad.gate[change]:'different';assert.throws(()=>validateHistoricalModelProof(bad,p,row,f.binding,at));
});
for(const change of ['payloadSha256','resultSha256'])test('reject changed '+change,async t=>{const {proof,p,row,f,at}=await setup(t);assert.throws(()=>validateHistoricalModelProof({...proof,[change]:'0'.repeat(64)},p,row,f.binding,at));});
test('reject a model-profile substitution and queued or late result',async t=>{
 const {proof,p,row,f,at}=await setup(t),bad=structuredClone(proof);bad.gate.costEnrollment.modelProfileSha256='f'.repeat(64);bad.gate.enrollmentId=hash(canonical(bad.gate.costEnrollment));assert.throws(()=>validateHistoricalModelProof(bad,p,row,f.binding,at));
 for(const patch of [{state:'queued'},{attempt:2},{updated_at:p.grantExpiresAt}])assert.throws(()=>validateHistoricalModelProof(proof,p,{...row,...patch},f.binding,p.grantExpiresAt));
});
test('proof enrollment is off by default and invalid pin cannot authorize a read',()=>{assert.equal(createHistoricalModelProofReader(),null);assert.throws(()=>createHistoricalModelProofReader({file:'/not-read',sha256:'bad'})('a'.repeat(64)));});
// Actual protected-file behavior is Linux-only, never replaced by a mocked reader.
import {mkdtempSync,writeFileSync,chmodSync,rmSync,symlinkSync,linkSync,unlinkSync,chownSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
test('protected proof loader pins bytes, rejects links/permissions and observes withdrawal',{skip:process.platform!=='linux'},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'historical-proof-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'proof.json'),ref='a'.repeat(64),value={v:1,kind:'PICARD_HISTORICAL_MODEL_RESULTS_V1',records:[{gate:{eventId:ref}}]},raw=JSON.stringify(value);
 writeFileSync(file,raw,{mode:0o640});if(process.getuid()!==0)execFileSync('sudo',['-n','chown','0:'+process.getgid(),file]);
 const read=createHistoricalModelProofReader({file,sha256:hash(raw)});assert.deepEqual(read(ref),value.records[0]);assert.equal(read('b'.repeat(64)),null);
 assert.throws(()=>createHistoricalModelProofReader({file,sha256:'f'.repeat(64)})(ref));
 const link=join(dir,'link');symlinkSync(file,link);assert.throws(()=>createHistoricalModelProofReader({file:link,sha256:hash(raw)})(ref));unlinkSync(link);
 const hard=join(dir,'hard');if(process.getuid()===0)linkSync(file,hard);else execFileSync('sudo',['-n','ln',file,hard]);assert.throws(()=>read(ref));unlinkSync(hard);
 if(process.getuid()===0)chownSync(file,65534,process.getgid());else execFileSync('sudo',['-n','chown','65534:'+process.getgid(),file]);assert.throws(()=>read(ref));
 if(process.getuid()===0)chownSync(file,0,process.getgid());else execFileSync('sudo',['-n','chown','0:'+process.getgid(),file]);
 const duplicate=join(dir,'duplicate.json'),dupRaw=JSON.stringify({...value,records:[value.records[0],value.records[0]]});writeFileSync(duplicate,dupRaw,{mode:0o640});if(process.getuid()!==0)execFileSync('sudo',['-n','chown','0:'+process.getgid(),duplicate]);assert.throws(()=>createHistoricalModelProofReader({file:duplicate,sha256:hash(dupRaw)})(ref));
 if(process.getuid()===0)chmodSync(file,0o666);else execFileSync('sudo',['-n','chmod','666',file]);assert.throws(()=>read(ref));
 if(process.getuid()===0)chmodSync(file,0o640);else execFileSync('sudo',['-n','chmod','640',file]);
 unlinkSync(file);assert.throws(()=>read(ref));
});

test('historical usage must name the independently approved model',async t=>{
 const {f,p,proof}=await setup(t),db=new DatabaseSync(f.dbPath),r=JSON.parse(f.store.get(p.eventId).result_json);
 r.providerUsage.model='openai/gpt-oss-20b';const raw=canonical(r);db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(raw,p.eventId);db.close();proof.resultSha256=hash(raw);
 assert.equal((await f.request('/workspace/requests/'+p.eventId)).status,409);assert.equal((await f.request('/workspace/config')).body.progress,null);assert.equal(f.calls,1);
});
