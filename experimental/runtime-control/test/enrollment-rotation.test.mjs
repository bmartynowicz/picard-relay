import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture} from '../../../test/fixtures/workspace-fixture.mjs';
import {canonical,signRequest,verifyResponse} from '../src/protocol.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {encodeInvocationError} from '../src/adapters.mjs';
import {admissionHash} from '../src/admission-store.mjs';
import {admissionConfigurationDigest} from '../src/admission-runtime.mjs';
import {planGroqKeyReplacement} from '../../../scripts/stage-groq-key-replacement.mjs';
import {parseGroqReplacementRequest,switchGroqKey} from '../../../scripts/serve-groq-key-replacement.mjs';
import {createConsoleHandler} from '../src/oracle-service.mjs';

const replacementId='00000000-0000-4000-8000-000000000001';
const syntheticKey='gsk_SYNTHETIC_REPLACEMENT_TEST_ONLY';
test('the key endpoint requires a recent same-origin owner session and keeps the secret out of replies',async()=>{
 const token='A'.repeat(43),origin='https://fixture.invalid';
 const valid={id:replacementId,key:syntheticKey,free:true};
 let recent=false,calls=0,connected=true,unknown=false;
 const idle={v:1,enabled:true,project:'Fixture / Default',state:'idle',id:null};
 const handler=createConsoleHandler({enabled:true,origins:[origin],auth:{authenticate:async(t,{fresh=false}={})=>t===token&&(!fresh||recent)},
  groqReplacement:{status:()=>({...idle,enabled:connected}),request:async input=>{calls++;assert.deepEqual(input,valid);if(unknown)throw Error(syntheticKey);return {...idle,state:'checking',id:replacementId};}}});
 async function send({method='POST',body=JSON.stringify(valid),headers={}}={}){
  const req=Readable.from([Buffer.from(body)]);
  Object.assign(req,{url:'/groq/key',method,headers:{host:'fixture.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'__Host-PicardSession='+token,...headers}});
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(text){assert.equal(text.includes(syntheticKey),false);this.body=JSON.parse(text);}};
  assert.equal(await handler(req,res),true);
  assert.equal(res.headers['Cache-Control'],'no-store, private');
  return res;
 }
 assert.equal((await send({headers:{cookie:''}})).status,401);
 assert.equal((await send({headers:{origin:'https://evil.invalid'}})).status,403);
 assert.equal((await send({headers:{'sec-fetch-site':'cross-site'}})).status,403);
 assert.equal((await send({headers:{origin:undefined}})).status,403);
 assert.equal((await send({method:'GET'})).body.recent,false);
 assert.equal((await send()).status,428);
 recent=true;connected=false;
 assert.equal((await send()).status,503);
 connected=true;
 for(const body of [{...valid,free:false},{...valid,command:'restart'},{...valid,key:syntheticKey+'\n'},{...valid,id:replacementId+'\n'}]){
  assert.equal((await send({body:JSON.stringify(body)})).status,400);
 }
 assert.equal((await send({body:'x'.repeat(1025)})).status,413);
 assert.equal(calls,0);
 assert.equal((await send({method:'GET'})).body.recent,true);
 assert.equal((await send()).status,202);
 unknown=true;
 assert.deepEqual((await send()).body,{error:'key_replacement_unknown'});
 assert.equal(calls,2);
});

test('host handoff accepts only one exact enrollment, key and owner Free confirmation',()=>{
 const body={v:1,id:replacementId,key:syntheticKey,free:true,enrollmentId:'b'.repeat(64)};
 assert.deepEqual(parseGroqReplacementRequest(JSON.stringify(body)),body);
 for(const patch of [{free:false},{directory:'/tmp'},{id:'../key'},{key:'not-a-key'},{enrollmentId:'b'.repeat(65)}]){
  assert.throws(()=>parseGroqReplacementRequest(JSON.stringify({...body,...patch})),/key_replacement_preflight/);
 }
});

test('host switch drains before activation, guards rollback and never probes the provider',async()=>{
 const target='releases/'+'a'.repeat(64);
 for(const mode of ['success','drain-failure','restore','stop-failure']){
  const order=[];
  const adapter={
   quiesce:async()=>{order.push('drain');if(mode==='drain-failure')throw Error('not drained');},
   start:async release=>{assert.equal(release,target);order.push('start');},
   health:async options=>{assert.equal(options.noProviderCalls,true);order.push(options.requireProviderReady?'new health':'old health');return !options.requireProviderReady||mode==='success';},
   stop:async()=>{order.push('stop');if(mode==='stop-failure')throw Error('not stopped');},
  };
  const outcome=await switchGroqKey({adapter,target,activate:()=>order.push('activate'),restore:()=>order.push('restore'),
   stopFailedStart:()=>false,checkActive:()=>true,checkRestored:()=>true});
  const expected={
   success:['replaced','drain','activate','start','new health'],
   'drain-failure':['unknown','drain'],
   restore:['rejected','drain','activate','start','new health','stop','restore','start','old health'],
   'stop-failure':['unknown','drain','activate','start','new health','stop'],
  }[mode];
  assert.deepEqual([outcome,...order],expected);
 }
});
const fixture=async t=>{const f=await workspaceFixture();t.after(()=>f.close());return f;};
const complete=async f=>{const d=await f.prepare();await f.submit(d,await f.approve(d));assert.equal((await f.dispatcher.runOnce()).status,'completed');return d;};
function mutate(f,fn){const db=new DatabaseSync(f.dbPath);try{fn(db);}finally{db.close();}}
function snapshot(f){let result;mutate(f,db=>{result=canonical({jobs:db.prepare('SELECT * FROM relay_jobs ORDER BY event_id').all(),nonces:db.prepare('SELECT * FROM relay_nonces ORDER BY nonce').all()});});return result;}
function signedClient(f){
 const config={keyId:'fixture',secret:'SYNTHETIC_ROTATION_SECRET_01234567890123456789',ownerId:f.binding.ownerId,allowedTaskId:f.binding.taskId,assistantId:f.binding.assistantId,admissionReusableBoardEnabled:true};
 const router=f.router,adapter={...router,localTestOnly:false};
 const receiver=createReceiver({store:f.store.relay,config,assistantAdapter:adapter});
 return async body=>{const s=await signRequest('https://fixture.invalid/bridge/v1',{v:1,ownerId:config.ownerId,...body},config),r=await receiver(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};};
}
test('rotation preserves immutable owner provenance and expired owner reads, never authority',async t=>{
 const f=await fixture(t),d=await complete(f),ref=d.payload.eventId,before=snapshot(f),original=(await f.request('/workspace/requests/'+ref)).body;
 await f.rotateEnrollment();assert.equal(snapshot(f),before);assert.equal(f.store.getWorkspaceWork(ref),null);assert.equal(f.router.acceptsWorkScope(d.payload),false);
 const saved=await f.request('/workspace/requests/'+ref);assert.equal(saved.status,200);assert.deepEqual(saved.body.provenance,original.provenance);assert.equal(saved.body.provenance.maxOutputTokens,4096);assert.equal(saved.body.provenance.approvedAt,d.approval.issuedAt);assert.equal(saved.body.provenance.source,'Owner console');assert.equal(saved.body.result.body,f.output);
 f.advance(3600001);assert.equal((await f.request('/workspace/requests/'+ref)).status,200);assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.calls,1);assert.equal(snapshot(f),before);
});
test('rotated signed exchange reads completed work without registration or invocation; expiry/revocation stay enforced',async t=>{
 const f=await fixture(t),d=await complete(f);await f.rotateEnrollment();const signed=signedClient(f),body={action:'exchange',payload:d.payload,approval:d.approval};
 for(let i=0;i<2;i++){const r=await signed(body);assert.equal(r.status,200);assert.equal(r.body.result.body,f.output);}
 assert.equal(f.calls,1);assert.equal((await f.dispatcher.runOnce()).status,'idle');
 const tampered={...d.payload,taskId:'other'};assert.notEqual((await signed({...body,payload:tampered})).status,200);
 f.store.relay.cancel(d.payload.ownerId,d.payload.taskId,d.payload.grantId);assert.equal((await signed(body)).body.error,'scope_revoked');
});
test('rotated exchange retains expiry boundary independently of owner read',async t=>{
 const f=await fixture(t),d=await complete(f);await f.rotateEnrollment();f.advance(900001);const r=await signedClient(f)({action:'exchange',payload:d.payload});assert.equal(r.body.error,'scope_expired');assert.equal((await f.request('/workspace/requests/'+d.payload.eventId)).status,200);assert.equal(f.calls,1);
});
for(const damage of ['association-missing','association-duplicate','association-expiry','approval-source','approval-hash','approval-owner'])test('historical read fails closed: '+damage,async t=>{
 const f=await fixture(t),d=await complete(f),ref=d.payload.eventId;await f.rotateEnrollment();
 mutate(f,db=>{
  const association=db.prepare("SELECT nonce FROM relay_nonces WHERE nonce GLOB ?").get('picard-admission:v1:enrollment:*:'+ref).nonce;
  if(damage==='association-missing')db.prepare('DELETE FROM relay_nonces WHERE nonce=?').run(association);
  if(damage==='association-duplicate')db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run('picard-admission:v1:enrollment:'+'f'.repeat(64)+':'+ref,Number.MAX_SAFE_INTEGER);
  if(damage==='association-expiry')db.prepare('UPDATE relay_nonces SET expires=1 WHERE nonce=?').run(association);
  if(damage==='approval-owner')db.prepare("UPDATE relay_jobs SET owner='other-owner' WHERE event_id=?").run(ref);
  if(damage==='approval-source'||damage==='approval-hash'){
   const nonce=db.prepare('SELECT nonce FROM relay_nonces WHERE nonce GLOB ?').get('picard-admission:v1:owner-console:'+ref+':*').nonce,at=nonce.lastIndexOf(':'),record=JSON.parse(Buffer.from(nonce.slice(at+1),'base64url'));
   if(damage==='approval-source')record.source='authenticated-reusable-board';else record.workSha256='f'.repeat(64);
   db.prepare('UPDATE relay_nonces SET nonce=? WHERE nonce=?').run(nonce.slice(0,at+1)+Buffer.from(canonical(record)).toString('base64url'),nonce);
  }
 });
 assert.notEqual((await f.request('/workspace/requests/'+ref)).status,200);assert.equal(f.router.acceptsSavedWorkScope(d.payload),false);assert.equal(f.calls,1);
 if(damage.startsWith('association'))assert.equal(f.store.hasEnrollmentUncertainty(f.binding.enrollmentId),true);
});
for(const state of ['draft','queued','claimed','invoking','uncertain'])test('rotation never promotes or retries old '+state,async t=>{
 const f=await fixture(t),d=await f.prepare(),proof=await f.approve(d);
 if(state!=='draft')await f.submit(d,proof);
 if(['claimed','invoking'].includes(state)){const row=f.router.claimNext({workerId:'lost',claimTtlMs:60000});if(state==='invoking')f.store.relay.startInvocation({requestId:row.event_id,attempt:row.attempt,workerId:'lost'});}
 if(state==='uncertain'){f.setMode('uncertain');await f.dispatcher.runOnce();f.setMode('complete');}
 const calls=f.calls;await f.rotateEnrollment();const before=snapshot(f);f.advance(61000);
 assert.equal(f.router.acceptsWorkScope(d.payload),false);assert.equal(f.router.acceptsSavedWorkScope(d.payload),false);assert.notEqual((await f.submit(d,proof)).status,201);
 for(let i=0;i<2;i++)assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.calls,calls);
 if(['invoking','uncertain'].includes(state)){assert.equal(f.store.hasEnrollmentUncertainty(f.binding.enrollmentId),true);assert.equal(f.router.availability().pendingUncertainty,true);assert.equal(f.router.availability().isolatedFailures,true);}
 if(state!=='draft')assert.equal(f.store.get(d.payload.eventId).state,state);
 // New exact approvals remain bounded and independent, with no old-row rewrite.
 const next=await f.prepare();await f.submit(next,await f.approve(next));assert.equal((await f.dispatcher.runOnce()).status,'completed');assert.equal(f.calls,calls+1);assert.equal(next.approval.maxCompletionTokens,4096);
});
test('old shared and malformed pending names block current readiness without changing evidence',async t=>{
 const f=await fixture(t);const old=f.binding.enrollmentId;await f.rotateEnrollment();
 for(const name of ['.groq-cost-'+old+'.pending','.groq-cost-malformed','unknown.pending','groq-once-00000000-0000-4000-8000-000000000001.consumed.pending']){
  const file=path.join(f.dir,name);fs.writeFileSync(file,'SYNTHETIC_PENDING_ONLY',{mode:0o600});assert.equal(f.router.availability().acceptingRequests,false,name);assert.equal(f.router.availability().pendingUncertainty,true);assert.equal(fs.readFileSync(file,'utf8'),'SYNTHETIC_PENDING_ONLY');fs.unlinkSync(file);
 }
 assert.equal(f.router.availability().acceptingRequests,true);assert.equal(f.calls,0);
});
test('signed board historical provenance retains its original source and approval time',async t=>{
 const f=await fixture(t),d=await f.prepare(),{payload,approval}=d;
 f.store.commitReusableBoard({payload,approval,currentAvailability:f.router.availability,revalidate:()=>true});assert.equal((await f.dispatcher.runOnce()).status,'completed');await f.rotateEnrollment();
 const saved=await f.request('/workspace/requests/'+payload.eventId);assert.equal(saved.status,200);assert.equal(saved.body.provenance.source,'Signed task board');assert.equal(saved.body.provenance.approvedAt,approval.issuedAt);assert.equal(saved.body.provenance.maxOutputTokens,4096);assert.equal(f.store.getReusableBoard(payload.eventId),null);assert.equal(f.router.acceptsSavedWorkScope(payload),true);assert.equal(f.calls,1);
});
test('prior per-grant pending evidence remains isolated only with intact job and enrollment association',async t=>{
 const f=await fixture(t),d=await f.prepare(),old=f.binding.enrollmentId;await f.submit(d,await f.approve(d));f.setMode('uncertain');await f.dispatcher.runOnce();await f.rotateEnrollment();
 const name=path.join(f.dir,'groq-once-'+d.payload.grantId+'.consumed.pending'),record={v:1,enrollmentId:old,state:'pending-before-io'};fs.writeFileSync(name,JSON.stringify(record),{mode:0o600});
 assert.equal(f.router.availability().pendingUncertainty,true);assert.equal(f.router.availability().acceptingRequests,true);assert.equal(f.router.acceptsWorkScope(d.payload),false);
 for(const bad of ['invalid',JSON.stringify({...record,enrollmentId:f.binding.enrollmentId}),JSON.stringify({...record,state:'resolved'})]){fs.writeFileSync(name,bad);assert.equal(f.router.availability().acceptingRequests,false);}
 fs.writeFileSync(name,JSON.stringify(record));mutate(f,db=>db.prepare('DELETE FROM relay_nonces WHERE nonce GLOB ?').run('picard-admission:v1:enrollment:*:'+d.payload.eventId));assert.equal(f.router.availability().acceptingRequests,false);assert.equal(fs.readFileSync(name,'utf8'),JSON.stringify(record));assert.equal(f.calls,1);
});

test('offline staging binds a new Free key and creates no grants',()=>{
 const oldKey='SYNTHETIC_OLD_KEY_ONLY',newKey='SYNTHETIC_NEW_KEY_ONLY',at=1794258000000,markerDirectory='/private/markers';
 const config={ownerId:'fixture-owner',allowedTaskId:'legacy-fixture',assistantId:'groq:openai/gpt-oss-20b',keyId:'fixture',consoleOrigins:['https://fixture.invalid'],workspaceEnabled:true,admissionReusableBoardEnabled:true,admissionSignedBridgeEnabled:true};
 const old={v:1,provider:'groq',model:'openai/gpt-oss-20b',owner:config.ownerId,accountLabel:'Fixture',organizationId:'org',projectId:'free',keySha256:admissionHash(oldKey),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-6000,enrolledAt:at-5000,evidenceRef:'free evidence',keyAssociationEvidenceRef:'original key proof'};
 const enrollmentId=admissionHash(canonical(old));
 const oldGate={v:3,owner:config.ownerId,task:config.allowedTaskId,enrollmentId,costEnrollment:old};
 const oldPolicy={v:1,costEnrollment:old,configurationSha256:admissionConfigurationDigest({config,enrollmentId,keySha256:old.keySha256,markerDirectory}),catalogue:{v:1,kind:'FINITE_ADMISSION_PROTOTYPE_ONLY',ownerId:config.ownerId,taskId:config.allowedTaskId,assistantId:config.assistantId,enrollmentId,notBefore:at-5000,expiresAt:at+60000,maxRequestLifetimeMs:600000,entries:[]}};
 const evidence={v:1,accountLabel:old.accountLabel,organizationId:old.organizationId,projectId:old.projectId,accountPlan:'Free',noPaidFallback:true,verifiedAt:at-1000,evidenceRef:'new free evidence',keyAssociationEvidenceRef:'new key proof'};
 const args={config,markerDirectory,oldGate,oldKey,oldPolicy,newKey,evidence,at};
 const original=canonical(args),plan=planGroqKeyReplacement(args);
 assert.equal(canonical(args),original);
 assert.equal(plan.gate.costEnrollment.keySha256,admissionHash(newKey));
 assert.deepEqual(plan.history.previous,[old]);
 assert.equal(plan.history.activeEnrollmentId,plan.gate.enrollmentId);
 assert.deepEqual(plan.policy.catalogue.entries,[]);
 assert.equal(plan.policy.catalogue.enrollmentId,plan.gate.enrollmentId);
 assert.doesNotMatch(canonical(plan),/SYNTHETIC_(OLD|NEW)_KEY_ONLY/);
 for(const change of [{newKey:oldKey},{oldKey:newKey},{evidence:{...evidence,accountPlan:'Paid'}},{evidence:{...evidence,projectId:'other'}},
  {evidence:{...evidence,verifiedAt:at+1}},{evidence:{...evidence,keyAssociationEvidenceRef:old.keyAssociationEvidenceRef}},
  {previous:[{...old,keySha256:admissionHash(newKey)}]}]) assert.throws(()=>planGroqKeyReplacement({...args,...change}),/groq_replacement_invalid/);
});

test('a different key can resume only with intact old 401 evidence and the original legacy inventory',
 {skip:process.platform!=='linux'?'Requires actual private Linux reservation files.':false},async t=>{
  const f=await workspaceFixture({preserveLegacyBaseline:true});t.after(()=>f.close());
  const old=await complete(f);f.advance(61000);
  const rejected=await f.prepare(),proof=await f.approve(rejected);await f.submit(rejected,proof);f.setMode('unauthorized');
  assert.equal((await f.dispatcher.runOnce()).status,'blocked');
  const ref=rejected.payload.eventId,row=f.store.get(ref),prior=f.binding.enrollmentId;
  const consumed=path.join(f.dir,'groq-once-'+rejected.payload.grantId+'.consumed'),pending=consumed+'.pending';
  const consumedBytes=fs.readFileSync(consumed,'utf8'),pendingBytes=fs.readFileSync(pending,'utf8'),before=snapshot(f);
  assert.equal(f.router.availability().acceptingRequests,false);
  assert.equal(f.calls,2);
  await f.rotateEnrollment({provePredecessor:true});f.setMode('complete');
  assert.equal(snapshot(f),before);assert.notEqual(f.binding.enrollmentId,prior);
  assert.equal(f.store.legacyAdmissionReady(f.binding.enrollmentId),true);
  assert.equal(f.store.legacyAdmissionReady(prior),false);
  assert.equal(f.router.availability().acceptingRequests,true);
  assert.equal(f.router.acceptsWorkScope(rejected.payload),false);
  assert.equal((await f.dispatcher.runOnce()).status,'idle');
  assert.equal((await f.request('/workspace/requests/'+old.payload.eventId)).body.result.body,f.output);
  fs.writeFileSync(consumed,consumedBytes.replace(ref,'0'.repeat(64)));
  assert.equal(f.router.availability().acceptingRequests,false);
  fs.writeFileSync(consumed,consumedBytes);
  mutate(f,db=>db.prepare('UPDATE relay_jobs SET last_error=? WHERE event_id=?').run(encodeInvocationError('groq_request_rejected',{phase:'http',code:'http_rejected',httpStatus:403}),ref));
  assert.equal(f.router.availability().acceptingRequests,false);
  mutate(f,db=>db.prepare('UPDATE relay_jobs SET last_error=? WHERE event_id=?').run(row.last_error,ref));
  assert.equal(snapshot(f),before);assert.equal(f.router.availability().acceptingRequests,true);
  f.advance(61000);const next=await complete(f);
  assert.notEqual(next.payload.grantId,rejected.payload.grantId);assert.equal(f.calls,3);
  assert.equal(fs.readFileSync(consumed,'utf8'),consumedBytes);assert.equal(fs.readFileSync(pending,'utf8'),pendingBytes);
  assert.deepEqual(f.store.get(ref),row);
 });
