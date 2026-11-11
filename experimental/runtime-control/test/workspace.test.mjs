import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspaceFixture,fixtureToken} from '../../../test/fixtures/workspace-fixture.mjs';
import {DatabaseSync} from 'node:sqlite';
const fixture=async(t,options)=>{const f=await workspaceFixture(options);t.after(()=>f.close());return f;};
test('training derives from owned durable work and reviews, survives restart and never invokes',async t=>{
 const f=await fixture(t);assert.deepEqual((await f.request('/workspace/config')).body.training,{v:1,hasSavedResult:false,hasReviewedResult:false});
 const d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);assert.equal((await f.request('/workspace/config')).body.training.hasSavedResult,false);await f.dispatcher.runOnce();
 assert.deepEqual((await f.request('/workspace/config')).body.training,{v:1,hasSavedResult:true,hasReviewedResult:false});const result=(await f.request('/workspace/requests/'+d.payload.eventId)).body;
 await f.request('/workspace/reviews/'+result.ref,{body:{expectedRevision:0,decision:'changes_requested',note:'Learning includes requesting corrections.',resultSha256:result.result.sha256}});f.restart();
 assert.deepEqual((await f.request('/workspace/config')).body.training,{v:1,hasSavedResult:true,hasReviewedResult:true});assert.equal(f.calls,1);
 const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE relay_jobs SET owner=? WHERE event_id=?').run('another-owner',result.ref);db.close();const config=await f.request('/workspace/config');assert.equal(config.status,200);assert.equal(config.body.training,null);assert.equal(f.calls,1);
});
test('corrupted reviewed output cannot earn a rank or make configuration unavailable',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);await f.dispatcher.runOnce();const result=(await f.request('/workspace/requests/'+d.payload.eventId)).body;
 await f.request('/workspace/reviews/'+result.ref,{body:{expectedRevision:0,decision:'accepted',note:'Original reviewed.',resultSha256:result.result.sha256}});
 const db=new DatabaseSync(f.dbPath),saved=JSON.parse(f.store.get(result.ref).result_json);db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(JSON.stringify({...saved,body:'Tampered result'}),result.ref);db.close();const config=await f.request('/workspace/config');assert.equal(config.status,200);assert.equal(config.body.training,null);assert.equal(f.calls,1);
});
test('ordinary request: inert draft, exact approval, one call, restart and recover unchanged output',async t=>{
 const f=await fixture(t),d=await f.prepare();assert.equal(f.calls,0);assert.equal(f.store.get(d.payload.eventId),null);
 assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).body.state,'draft');
 const proof=await f.approve(d),queued=await f.submit(d,proof);assert.equal(queued.status,201);assert.equal(queued.body.state,'queued');
 assert.equal((await f.dispatcher.runOnce()).status,'completed');assert.equal(f.calls,1);f.restart();
 const saved=await f.request('/workspace/requests/'+d.payload.eventId);assert.equal(saved.body.result.body,f.output);assert.equal(saved.body.provenance.source,'Owner console');assert.equal(saved.body.provenance.maxOutputTokens,4096);const expectedUsage=process.platform==='linux'?150:null;assert.equal(saved.body.provenance.measuredTokens,expectedUsage);assert.equal(saved.body.provenance.providerUsage?.totalTokens??null,expectedUsage);assert.equal(saved.body.provenance.billedUsd,null);assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.calls,1);
});
test('concurrent duplicate prepare/approval returns one immutable draft, grant and job',async t=>{
 const f=await fixture(t),brief=f.brief(),drafts=await Promise.all([f.prepare(brief),f.prepare(brief)]);assert.deepEqual(drafts[0],drafts[1]);const d=drafts[0],proof=await f.approve(d);
 const results=await Promise.all([f.submit(d,proof),f.submit(d,proof)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal((await f.dispatcher.runOnce()).status,'completed');assert.equal(f.calls,1);
 assert.equal((await f.request('/workspace/drafts',{body:{...brief,requestText:'Changed input'}})).status,409);
});
test('lost submission response recovers same job and does not create replacement work',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);f.loseResponse();assert.equal((await f.submit(d,proof)).status,503);f.loseResponse(false);
 assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).body.state,'queued');assert.equal((await f.submit(d,proof)).status,200);assert.equal((await f.dispatcher.runOnce()).status,'completed');assert.equal(f.calls,1);
});
test('owner, session, origin and body boundaries reject before private reads or invocation',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);
 for(const headers of [{origin:'https://evil.invalid'},{host:'evil.invalid'},{'sec-fetch-site':'cross-site'}])assert.equal((await f.request('/workspace/config',{headers})).status,403);
 for(const cookie of ['', '__Host-PicardSession=bad',`__Host-PicardSession=${fixtureToken};__Host-PicardSession=${fixtureToken}`])assert.equal((await f.request('/workspace/requests/'+d.payload.eventId,{headers:{cookie}})).status,401);
 assert.equal((await f.submit(d,proof,{draftSha256:'f'.repeat(64)})).status,409);
 assert.equal((await f.request('/workspace/drafts',{body:{...f.brief(),ownerId:'other'}})).status,400);
 assert.equal((await f.request('/workspace/drafts',{raw:'x'.repeat(24577)})).status,413);
 f.rotateSession();assert.equal((await f.submit(d,proof)).status,401);assert.equal(f.calls,0);
});
test('expiry and provider blocks keep drafts inert and never renew grants',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);f.setAvailable(false);assert.equal((await f.submit(d,proof)).status,503);f.setAvailable(true);f.advance(60001);assert.equal((await f.submit(d,proof)).status,409);f.advance(900000);assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).body.state,'expired');assert.equal(f.calls,0);
});
test('uncertainty is preserved across restart and never replayed',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);f.setMode('uncertain');assert.equal((await f.dispatcher.runOnce()).status,'uncertain');assert.equal(f.calls,1);f.restart();f.advance(61000);
 for(let i=0;i<3;i++)assert.equal((await f.dispatcher.runOnce()).status,'idle');const saved=await f.request('/workspace/requests/'+d.payload.eventId);assert.equal(saved.body.state,'uncertain');assert.equal(saved.body.resultAvailable,false);assert.equal(f.calls,1);
});
test('a process lost after invocation boundary becomes uncertain without a second call',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);const claim=f.router.claimNext({workerId:'interrupted',claimTtlMs:60000});f.store.relay.startInvocation({requestId:claim.event_id,attempt:claim.attempt,workerId:'interrupted'});f.restart();f.advance(61000);assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.store.get(d.payload.eventId).state,'uncertain');assert.equal(f.calls,0);
});
test('review is durable, append-only, output-bound, idempotent and conflict checked',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);await f.dispatcher.runOnce();const ref=d.payload.eventId,saved=(await f.request('/workspace/requests/'+ref)).body;
 const body={expectedRevision:0,decision:'changes_requested',note:'Please cover the exact boundary.',resultSha256:saved.result.sha256},url='/workspace/reviews/'+ref;
 assert.equal((await f.request(url,{body})).body.review.revision,1);assert.equal((await f.request(url,{body})).body.review.revision,1);
 assert.equal((await f.request(url,{body:{...body,decision:'accepted'}})).status,409);assert.equal((await f.request(url,{body:{...body,expectedRevision:1,decision:'accepted',resultSha256:'a'.repeat(64)}})).status,409);
 assert.equal((await f.request(url,{body:{...body,expectedRevision:1,decision:'accepted',note:'Reviewed locally.'}})).body.review.revision,2);f.restart();
 const result=(await f.request('/workspace/requests/'+ref)).body;assert.equal(result.review.history.length,2);assert.equal(result.review.latest.decision,'accepted');assert.equal(result.result.body,f.output);assert.equal(f.calls,1);
});

test('earned work counts distinct accepted results across owner tasks, review revisions and restart',async t=>{
 const f=await fixture(t),refs=[];
 for(let i=0;i<6;i++){
  if(i)f.advance(61000);
  const d=await f.prepare(f.brief({taskId:'task-'+i}));await f.submit(d,await f.approve(d));await f.dispatcher.runOnce();
  const saved=(await f.request('/workspace/requests/'+d.payload.eventId)).body;refs.push(saved);
  await f.request('/workspace/reviews/'+saved.ref,{body:{expectedRevision:0,decision:i===5?'changes_requested':'accepted',note:'Synthetic review',resultSha256:saved.result.sha256}});
 }
 const config=() => f.request('/workspace/config');
 assert.deepEqual((await config()).body.progress,{v:1,acceptedWork:5,atLeast:false});
 assert.equal(f.store.relay.recentJobs({ownerId:f.binding.ownerId,limit:1}).rows.length,1);
 const first=refs[0],url='/workspace/reviews/'+first.ref;
 await f.request(url,{body:{expectedRevision:1,decision:'accepted',note:'Second review, same work',resultSha256:first.result.sha256}});
 assert.equal((await config()).body.progress.acceptedWork,5);
 await f.request(url,{body:{expectedRevision:2,decision:'changes_requested',note:'Credit withdrawn',resultSha256:first.result.sha256}});
 assert.equal((await config()).body.progress.acceptedWork,4);f.restart();assert.equal((await config()).body.progress.acceptedWork,4);
 assert.equal(f.calls,6);
 const db=new DatabaseSync(f.dbPath),r=JSON.parse(f.store.get(refs[1].ref).result_json);db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(JSON.stringify({...r,body:'Unreviewed replacement'}),refs[1].ref);db.close();
 assert.equal((await config()).body.progress,null);assert.equal((await config()).status,200);
});

test('earned work reaches 100+ beyond every browser history page without new provider calls on reads',async t=>{
 const f=await fixture(t);f.policy.catalogue.expiresAt+=6*3600000;
 for(let i=0;i<101;i++){
  if(i)f.advance(61000);
  const d=await f.prepare();await f.submit(d,await f.approve(d));await f.dispatcher.runOnce();
  const saved=(await f.request('/workspace/requests/'+d.payload.eventId)).body;
  const r=await f.request('/workspace/reviews/'+saved.ref,{body:{expectedRevision:0,decision:'accepted',note:'Synthetic',resultSha256:saved.result.sha256}});assert.equal(r.status,200);
 }
 f.restart();const calls=f.calls;
 for(let i=0;i<2;i++)assert.deepEqual((await f.request('/workspace/config')).body.progress,{v:1,acceptedWork:100,atLeast:true});
 assert.equal(f.calls,calls);assert.equal(f.store.relay.recentJobs({ownerId:f.binding.ownerId}).rows.length,25);
});
test('owner result recovery includes prior tasks and excludes foreign owners',async t=>{
 const f=await fixture(t),d=await f.prepare(f.brief({taskId:'prior-board-task'})),proof=await f.approve(d);await f.submit(d,proof);await f.dispatcher.runOnce();assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).status,200);
 const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE relay_jobs SET owner=? WHERE event_id=?').run('another-owner',d.payload.eventId);db.close();assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).status,404);
});
test('configuration changes invalidate an old draft rather than broadening its authority',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);f.policy.configurationSha256='c'.repeat(64);assert.equal((await f.submit(d,proof)).status,503);assert.equal(f.calls,0);
});
test('a review of an original answer never becomes acceptance of changed stored text',async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);await f.submit(d,proof);await f.dispatcher.runOnce();const ref=d.payload.eventId,saved=(await f.request('/workspace/requests/'+ref)).body;
 await f.request('/workspace/reviews/'+ref,{body:{expectedRevision:0,decision:'accepted',note:'Original answer reviewed.',resultSha256:saved.result.sha256}});
 const db=new DatabaseSync(f.dbPath),result=JSON.parse(f.store.get(ref).result_json);db.prepare('UPDATE relay_jobs SET result_json=? WHERE event_id=?').run(JSON.stringify({...result,body:'Different unreviewed text'}),ref);db.close();assert.equal((await f.request('/workspace/requests/'+ref)).status,409);assert.equal(f.calls,1);
});
