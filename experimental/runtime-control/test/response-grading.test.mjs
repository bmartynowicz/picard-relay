import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture} from '../../../test/fixtures/workspace-fixture.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {signRequest,verifyResponse} from '../src/protocol.mjs';

async function completed(t){const f=await workspaceFixture();t.after(()=>f.close());const draft=await f.prepare();await f.submit(draft,await f.approve(draft));await f.dispatcher.runOnce();return {f,result:(await f.request('/workspace/requests/'+draft.payload.eventId)).body};}
const bodyFor=(result,patch={})=>({expectedRevision:0,score:4,note:'Useful, with a clear boundary.',resultSha256:result.result.sha256,...patch});
function signedClient(f,result,options={}){
 const config={ownerId:f.binding.ownerId,assistantId:f.binding.assistantId,allowedTaskId:f.binding.taskId,
  keyId:'fixture-client',secret:'SYNTHETIC_GRADE_TRANSPORT_SECRET_1234567890',admissionReusableBoardEnabled:true,workspaceEnabled:true,...options};
 const receive=createReceiver({store:f.store.relay,config,assistantAdapter:f.router,gradeResult:v=>f.store.saveWorkspaceGrade(v),readGrade:ref=>f.store.workspaceGrade(ref)});
 const payload={v:1,action:'grade',ownerId:config.ownerId,taskId:result.request.taskId,eventId:result.ref,payloadHash:result.provenance.payloadSha256,...bodyFor(result)};
 return {config,payload,async send(value=payload,credential=config){const signed=await signRequest('https://fixture.invalid/bridge/v1',value,credential),response=await receive(signed.request);return {status:response.status,body:await verifyResponse(response,signed.nonce,config)};}};
}
test('owner quality grade is output-bound, append-only and durable without acceptance, rank credit or another call',async t=>{
 const {f,result}=await completed(t),before=f.store.get(result.ref).result_json,url='/workspace/grades/'+result.ref,body=bodyFor(result);
 const first=await f.request(url,{body});assert.equal(first.status,200);assert.deepEqual(first.body.grade.latest.reviewer,{kind:'owner'});assert.equal(first.body.grade.latest.score,4);
 assert.equal((await f.request(url,{body})).body.grade.revision,1);
 assert.equal((await f.request(url,{body:{...body,score:5}})).status,409);
 assert.equal((await f.request(url,{body:{...body,expectedRevision:1,score:5}})).body.grade.revision,2);
 f.restart();const saved=(await f.request('/workspace/requests/'+result.ref)).body;
 assert.deepEqual(saved.grade.history.map(g=>g.score),[4,5]);assert.equal(saved.review.revision,0);assert.equal(saved.result.body,result.result.body);
 assert.equal(f.store.get(result.ref).result_json,before);const config=(await f.request('/workspace/config')).body;
 assert.equal(config.progress.acceptedWork,0);assert.equal(config.training.hasReviewedResult,false);assert.equal(f.calls,1);
});
test('owner grade denies bad session/origin, spoofed reviewer, invalid scores, stale output and pending work',async t=>{
 const {f,result}=await completed(t),url='/workspace/grades/'+result.ref,body=bodyFor(result);
 for(const headers of [{cookie:''},{origin:'https://evil.invalid'},{'sec-fetch-site':'cross-site'}])assert.ok([401,403].includes((await f.request(url,{body,headers})).status));
 f.advance(61000);
 for(const patch of [{reviewer:{kind:'client',keyId:'fake'}},{score:0},{score:6},{score:1.5},{score:'4'},{note:'x'.repeat(501)},{expectedRevision:-1}])assert.equal((await f.request(url,{body:{...body,...patch}})).status,400);
 assert.equal((await f.request(url,{body:{...body,resultSha256:'a'.repeat(64)}})).status,409);
 f.advance(61000);const draft=await f.prepare();assert.equal((await f.request('/workspace/grades/'+draft.payload.eventId,{body})).status,404);
 await f.submit(draft,await f.approve(draft));assert.equal((await f.request('/workspace/grades/'+draft.payload.eventId,{body})).status,409);
 assert.equal(f.store.workspaceGrade(result.ref).revision,0);assert.equal(f.calls,1);
});
test('signed client gets server attribution and a compact grade projection, separate from owner acceptance',async t=>{
 const {f,result}=await completed(t),client=signedClient(f,result),before=f.store.get(result.ref).result_json;
 const graded=await client.send();assert.equal(graded.status,200);assert.deepEqual(graded.body.grade.latest.reviewer,{kind:'client',keyId:'fixture-client'});assert.equal(graded.body.grade.history,undefined);
 assert.equal((await client.send()).body.grade.revision,1);
 const saved=(await f.request('/workspace/requests/'+result.ref)).body;assert.equal(saved.grade.latest.reviewer.kind,'client');assert.equal(saved.review.revision,0);
 const read=await client.send({v:1,action:'grade_status',ownerId:client.config.ownerId,taskId:result.request.taskId,eventId:result.ref,payloadHash:result.provenance.payloadSha256});
 assert.equal(read.status,200);assert.equal(read.body.grade.revision,1);assert.equal(read.body.grade.history,undefined);
 const original=await client.send({v:1,action:'result',ownerId:client.config.ownerId,taskId:result.request.taskId,eventId:result.ref,payloadHash:result.provenance.payloadSha256});assert.equal(original.body.result.body,result.result.body);assert.equal(original.body.grade,undefined);
 assert.equal(f.store.get(result.ref).result_json,before);assert.equal((await f.request('/workspace/config')).body.progress.acceptedWork,0);assert.equal(f.calls,1);
});
test('signed grades reject cross-owner/task/source, unauthenticated clients, forged attribution and disabled workspace',async t=>{
 const {f,result}=await completed(t),client=signedClient(f,result);
 for(const patch of [{ownerId:'foreign-owner'},{taskId:'foreign-task'},{payloadHash:'b'.repeat(64)},{eventId:'c'.repeat(64)}])assert.equal((await client.send({...client.payload,...patch})).status,403);
 assert.equal((await client.send({...client.payload,resultSha256:'d'.repeat(64)})).status,409);
 assert.equal((await client.send({...client.payload,reviewer:{kind:'owner'}})).status,400);
 const wrong=await signRequest('https://fixture.invalid/bridge/v1',client.payload,{...client.config,secret:'WRONG_SYNTHETIC_SECRET_12345678901234567890'});
 const receiver=createReceiver({store:f.store.relay,config:client.config,assistantAdapter:f.router,gradeResult:v=>f.store.saveWorkspaceGrade(v)});assert.equal((await receiver(wrong.request)).status,403);
 assert.equal((await signedClient(f,result,{workspaceEnabled:false}).send()).status,400);
 assert.equal(f.store.workspaceGrade(result.ref).revision,0);assert.equal(f.calls,1);
});
test('saved grade corruption or altered result identity never becomes a current quality claim',async t=>{
 const {f,result}=await completed(t);await f.request('/workspace/grades/'+result.ref,{body:bodyFor(result)});
 const db=new DatabaseSync(f.dbPath),row=f.store.get(result.ref),saved=JSON.parse(row.result_json);db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(JSON.stringify({...saved,body:'Changed ungraded output'}),result.ref);db.close();
 const response=await f.request('/workspace/requests/'+result.ref);assert.equal(response.status,409);assert.equal(response.body.error,'existing_record_invalid');assert.equal(f.calls,1);
});
test('unreadable quality evidence cannot hide an intact answer or change valid accepted-work credit',async t=>{
 const {f,result}=await completed(t);await f.request('/workspace/reviews/'+result.ref,{body:{expectedRevision:0,decision:'accepted',note:'Reviewed original.',resultSha256:result.result.sha256}});
 await f.request('/workspace/grades/'+result.ref,{body:bodyFor(result)});const before=f.store.get(result.ref).result_json;
 const db=new DatabaseSync(f.dbPath);db.prepare("UPDATE relay_nonces SET expires=1 WHERE nonce GLOB '*:grade:*'").run();db.close();
 const saved=await f.request('/workspace/requests/'+result.ref);assert.equal(saved.status,200);assert.equal(saved.body.result.body,result.result.body);assert.equal(saved.body.grade,null);assert.equal(saved.body.review.latest.decision,'accepted');
 assert.equal((await f.request('/workspace/config')).body.progress.acceptedWork,1);assert.equal((await f.request('/workspace/grades/'+result.ref,{body:bodyFor(result)})).status,503);
 assert.equal(f.store.get(result.ref).result_json,before);assert.equal(f.calls,1);
});
test('owner grade cannot attach to another owner and a signed grade cannot alter corrupt result metadata',async t=>{
 const {f,result}=await completed(t),client=signedClient(f,result),db=new DatabaseSync(f.dbPath),saved=JSON.parse(f.store.get(result.ref).result_json);
 db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(JSON.stringify({...saved,taskId:'foreign-task'}),result.ref);
 assert.equal((await client.send()).status,409);assert.equal(f.store.workspaceGrade(result.ref).revision,0);
 db.prepare('UPDATE relay_jobs SET result_json=?,owner=? WHERE event_id=?').run(JSON.stringify(saved),'foreign-owner',result.ref);db.close();
 assert.equal((await f.request('/workspace/grades/'+result.ref,{body:bodyFor(result)})).status,404);
 assert.throws(()=>f.store.saveWorkspaceGrade({ref:result.ref,...bodyFor(result),reviewer:{kind:'owner'}}),/grade_unavailable/);assert.equal(f.calls,1);
});
test('revoked signed scope cannot grade while the original completed answer stays unchanged',async t=>{
 const {f,result}=await completed(t),client=signedClient(f,result),row=f.store.get(result.ref),before=row.result_json;
 f.store.relay.cancel(f.binding.ownerId,result.request.taskId,row.grant_id);
 assert.equal((await client.send()).status,403);assert.equal(f.store.workspaceGrade(result.ref).revision,0);assert.equal(f.store.get(result.ref).result_json,before);assert.equal(f.calls,1);
});
test('signed grade retains existing revocation/expiry boundary and cannot advance a spent job',async t=>{
 const {f,result}=await completed(t),client=signedClient(f,result);f.advance(901000);
 const response=await client.send();assert.equal(response.status,403);assert.equal(response.body.error,'owner_scope_denied');
 assert.equal(f.store.workspaceGrade(result.ref).revision,0);assert.equal(f.calls,1);
 // The authenticated owner can still grade an expired saved answer; no grant is extended.
 assert.equal((await f.request('/workspace/grades/'+result.ref,{body:bodyFor(result)})).status,200);assert.equal(f.calls,1);
});
test('grade history has a hard storage cap and signed responses stay bounded rather than returning the history',async t=>{
 const {f,result}=await completed(t);for(let i=0;i<100;i++)f.store.saveWorkspaceGrade({ref:result.ref,...bodyFor(result,{expectedRevision:i,note:'x'.repeat(500)}),reviewer:{kind:'owner'}});
 assert.throws(()=>f.store.saveWorkspaceGrade({ref:result.ref,...bodyFor(result,{expectedRevision:100}),reviewer:{kind:'owner'}}),/queue_capacity/);
 const client=signedClient(f,result),read=await client.send({v:1,action:'grade_status',ownerId:client.config.ownerId,taskId:result.request.taskId,eventId:result.ref,payloadHash:result.provenance.payloadSha256});
 assert.equal(read.status,200);assert.equal(read.body.grade.revision,100);assert.equal(read.body.grade.history,undefined);assert.ok(Buffer.byteLength(JSON.stringify(read.body))<24576);assert.equal(f.calls,1);
});
