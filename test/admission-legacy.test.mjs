// Synthetic cutover only. Never creates a production inventory or exception.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fixture,syntheticLegacyBaseline,token,origin} from './fixtures/admission-fixture.mjs';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';
import {planFiniteAdmission} from '../experimental/runtime-control/src/admission-plan.mjs';
import {admissionHash,createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';
import {createAdmissionAssistantAdapter} from '../experimental/runtime-control/src/admission-dispatch.mjs';
import {createLocalAdmissionHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createLegacyBaselineLoader} from '../experimental/runtime-control/src/admission-catalogue.mjs';
import {readLegacyAdmissionMarkers} from '../experimental/runtime-control/src/admission-runtime.mjs';

const linux={skip:process.platform!=='linux'?'Requires actual Linux ownership, no-follow file reads and modes.':false};
const edit=(f,fn)=>{const db=new DatabaseSync(f.dbPath);try{return fn(db);}finally{db.close();}};
async function legacyFixture(t,{state='completed',ack=true}={}){
 let baseline=null,markers=[];const options={loadLegacyBaseline:()=>baseline,readLegacyMarkers:()=>structuredClone(markers)};
 const f=await fixture(t,{slots:3,legacyOptions:options});options.legacyBinding=f.binding;f.restart();
 const first=f.entry.slots[0],plan=await planFiniteAdmission({mode:'synthetic-review-only',catalogue:f.catalogue,costEnrollment:f.enrollment,actor:{ownerId:f.binding.ownerId,approvedInputSha256:f.entry.inputSha256,approvedAt:f.now(),approvalRef:'SYNTHETIC_LEGACY_ONLY'},selection:{entryId:f.entry.entryId,slotId:first.slotId},at:f.now()});
 await f.store.relay.accept(plan.intent.payload);
 const claim=f.store.relay.claimNext({workerId:'synthetic-legacy',claimTtlMs:60000}),input={requestId:first.eventId,workerId:'synthetic-legacy',attempt:claim.attempt};f.store.relay.startInvocation(input);
 if(state==='completed'){f.store.relay.appendReply({...input,owner:f.binding.ownerId,task:f.binding.taskId,eventId:'resp:'+first.eventId,kind:'answer',outcomeKind:'information',body:'SYNTHETIC_LEGACY_SAVED_TEXT',statusChange:null});f.store.relay.markCompleted(input);}
 else edit(f,db=>db.prepare('UPDATE relay_jobs SET state=?,last_error=? WHERE event_id=?').run(state,'invocation_outcome_uncertain',first.eventId));
 const row=f.store.get(first.eventId),name='one-call-'+first.grantId+'.json',markerSha256=admissionHash('SYNTHETIC_CONSUMED_MARKER');
 const entry={eventId:first.eventId,grantId:first.grantId,state,rowSha256:admissionHash(canonical(row)),markerName:name,markerSha256,acknowledgement:state==='uncertain'&&ack?{eventId:first.eventId,grantId:first.grantId,approvalRef:'SYNTHETIC_EXPLICIT_HISTORICAL_ACK_ONLY',receiptSha256:'d'.repeat(64)}:null};
 baseline=syntheticLegacyBaseline(f,[entry]);markers=[{name,sha256:markerSha256}];f.entry.slots.shift();
 const router=createAdmissionAssistantAdapter({activationEnabled:true,loadPolicy:()=>f.policy,binding:f.binding,apiKey:'SYNTHETIC_ADMISSION_KEY_ONLY',markerDirectory:f.dir,now:f.now,testOnly:{synthetic:true,markerParentReady:()=>true,markerSpent:()=>false,adapterFactory:()=>({kind:'groq-durable-one-shot',assistantId:f.binding.assistantId,ready:true,canServeResults:true,answer(){throw Error('NO_PROVIDER_ALLOWED');}})}});router.attachStore(f.store);
 const handler=createLocalAdmissionHandler({mode:'synthetic-integration-only',store:f.store,auth:{authenticate:async v=>v===token},loadPolicy:()=>f.policy,binding:f.binding,origins:[origin],now:f.now,currentAvailability:router.availability});
 const request=(url,options={})=>f.request(url,{...options,adapter:handler});
 const selected={entryId:f.entry.entryId,slotId:f.entry.slots[0].slotId};
 const challenge=async()=>request('/request-approvals',{body:selected});
 const submit=proof=>request('/requests',{body:{...selected,nonce:proof.nonce,approvedInputSha256:f.entry.inputSha256,approve:true}});
 return {f,entry,row,router,request,challenge,submit,get baseline(){return baseline;},set baseline(v){baseline=v;},get markers(){return markers;},set markers(v){markers=v;},ready:()=>f.store.legacyAdmissionReady(f.binding.enrollmentId)};
}

test('missing explicit legacy inventory denies new work without mutating old rows or markers',async t=>{
 const p=await legacyFixture(t),before=canonical(p.f.store.get(p.row.event_id)),markers=canonical(p.markers);p.baseline=null;
 assert.equal(p.ready(),false);assert.equal(p.router.ready,false);assert.equal((await p.challenge()).status,503);
 const status=await p.request('/request-catalogue');assert.equal(status.body.blockingCode,'legacy_review_required');assert.equal(status.body.admissionReady,false);
 assert.equal(canonical(p.f.store.get(p.row.event_id)),before);assert.equal(canonical(p.markers),markers);
 const saved=await p.request('/requests/'+p.row.event_id);assert.equal(saved.status,200);assert.equal(saved.body.result.body,'SYNTHETIC_LEGACY_SAVED_TEXT');assert.equal(saved.body.mayInvoke,false);
 for(const privateValue of [p.row.event_id,p.row.grant_id,'receiptSha256','rowSha256','markerSha256'])assert.equal(JSON.stringify(status).includes(privateValue),false);
});

test('explicit completed inventory permits a distinct approved slot and preserves the complete legacy row',async t=>{
 const p=await legacyFixture(t),before=canonical(p.row);assert.equal(p.ready(),true);const proof=await p.challenge();assert.equal(proof.status,200);
 const result=await p.submit(proof.body);assert.equal(result.status,201);assert.notEqual(result.body.ref,p.row.event_id);assert.equal(p.ready(),true);assert.equal(canonical(p.f.store.get(p.row.event_id)),before);
 p.f.restart();assert.equal(p.ready(),true);assert.equal(p.f.store.get(result.body.ref).state,'queued');
});

test('uncertain history needs exact separately reviewed acknowledgement metadata and remains uncertain',async t=>{
 const p=await legacyFixture(t,{state:'uncertain',ack:false});assert.equal(p.ready(),false);assert.equal(p.router.ready,false);
 p.entry.acknowledgement={eventId:p.row.event_id,grantId:p.row.grant_id,approvalRef:'SYNTHETIC_EXPLICIT_HISTORICAL_ACK_ONLY',receiptSha256:'d'.repeat(64)};
 assert.equal(p.ready(),true);assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.binding.enrollmentId),false);
 assert.equal((await p.submit((await p.challenge()).body)).status,201);assert.equal(p.f.store.get(p.row.event_id).state,'uncertain');assert.equal(p.f.store.get(p.row.event_id).result_json,null);
});

for(const [name,mutate] of [
 ['event mismatch',p=>p.entry.acknowledgement.eventId='a'.repeat(64)],['grant mismatch',p=>p.entry.acknowledgement.grantId='other'],['no receipt',p=>p.entry.acknowledgement.receiptSha256=null],['control text',p=>p.entry.acknowledgement.approvalRef='PRIVATE\nERROR'],['extra approval authority',p=>p.entry.acknowledgement.allowReplay=true],
 ['missing inventory row',p=>p.baseline.rows=[]],['duplicate inventory row',p=>p.baseline.rows.push(structuredClone(p.entry))],['wrong enrollment',p=>p.baseline.enrollmentId='a'.repeat(64)],['wrong owner',p=>p.baseline.ownerId='other'],['future observation',p=>p.baseline.observedAt=p.f.now()+1],['extra baseline field',p=>p.baseline.acceptUnknown=true],['wrong row hash',p=>p.entry.rowSha256='a'.repeat(64)],['wrong marker hash',p=>p.markers[0].sha256='a'.repeat(64)],['missing marker',p=>p.markers=[]],['extra marker',p=>p.markers.push({name:'one-call-extra.json',sha256:'a'.repeat(64)})],['marker path',p=>p.entry.markerName='../one-call-outside.json'],
])test('legacy inventory fails closed: '+name,async t=>{const p=await legacyFixture(t,{state:'uncertain'});mutate(p);assert.equal(p.ready(),false);assert.equal(p.router.ready,false);assert.equal((await p.challenge()).status,503);});

for(const [column,value] of [['state','failed'],['last_error','PRIVATE_CHANGED_DIAGNOSTIC'],['updated_at',1],['payload_json','{}'],['result_json',null],['grant_id','changed']])test('same legacy row identity with changed '+column+' requires review',async t=>{
 const p=await legacyFixture(t);edit(p.f,db=>db.prepare('UPDATE relay_jobs SET '+column+'=? WHERE event_id=?').run(value,p.row.event_id));assert.equal(p.ready(),false);p.f.restart();assert.equal(p.ready(),false);
});

test('catalogue replacement cannot omit or override unresolved legacy history',async t=>{
 const p=await legacyFixture(t,{state:'uncertain',ack:false});p.f.entry.slots.pop();p.f.catalogue.notBefore--;
 assert.equal(p.ready(),false);assert.equal(p.router.ready,false);assert.equal((await p.challenge()).status,503);p.f.tick(60001);p.f.restart();assert.equal(p.ready(),false);
});

test('returning from legacy mode with one additional unassociated job blocks rather than regenerates the inventory',async t=>{
 const p=await legacyFixture(t);const plan=await planFiniteAdmission({mode:'synthetic-review-only',catalogue:p.f.catalogue,costEnrollment:p.f.enrollment,actor:{ownerId:p.f.binding.ownerId,approvedInputSha256:p.f.entry.inputSha256,approvedAt:p.f.now(),approvalRef:'SYNTHETIC_LEGACY_MODE_ONLY'},selection:{entryId:p.f.entry.entryId,slotId:p.f.entry.slots[1].slotId},at:p.f.now()});
 const original=canonical(p.baseline);await p.f.store.relay.accept(plan.intent.payload);assert.equal(p.ready(),false);p.f.restart();assert.equal(p.ready(),false);assert.equal(canonical(p.baseline),original);assert.equal(p.f.store.get(plan.intent.payload.eventId).state,'queued');
});

test('association backfill cannot exempt an inventoried old row',async t=>{
 const p=await legacyFixture(t);edit(p.f,db=>db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run('picard-admission:v1:enrollment:'+p.f.binding.enrollmentId+':'+p.row.event_id,Number.MAX_SAFE_INTEGER));assert.equal(p.ready(),false);
});

for(const [name,nonce,expires] of [['malformed','picard-admission:v1:enrollment:bad',Number.MAX_SAFE_INTEGER],['dangling','picard-admission:v1:enrollment:'+'a'.repeat(64)+':'+'b'.repeat(64),Number.MAX_SAFE_INTEGER]])test('legacy review refuses '+name+' enrollment metadata',async t=>{
 const p=await legacyFixture(t);edit(p.f,db=>db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(nonce,expires));assert.equal(p.ready(),false);
});

test('a new associated uncertain job still stops work despite an acknowledged immutable legacy row',async t=>{
 const p=await legacyFixture(t,{state:'uncertain'}),r=await p.submit((await p.challenge()).body);assert.equal(r.status,201);
 edit(p.f,db=>db.prepare("UPDATE relay_jobs SET state='uncertain' WHERE event_id=?").run(r.body.ref));assert.equal(p.ready(),true);assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.binding.enrollmentId),true);p.f.restart();assert.equal(p.f.store.hasEnrollmentUncertainty(p.f.binding.enrollmentId),true);
});

test('final atomic registration rejects a history change after approval without consuming its proof',async t=>{
 const p=await legacyFixture(t),proof=await p.challenge();assert.equal(proof.status,200);const old=structuredClone(p.entry);p.entry.markerSha256='a'.repeat(64);
 assert.equal((await p.submit(proof.body)).status,503);assert.equal(p.f.store.get(p.f.entry.slots[0].eventId),null);Object.assign(p.entry,old);assert.equal((await p.submit(proof.body)).status,201);
});

test('throwing and asynchronous inventory readers fail closed with no raw diagnostic or unhandled rejection',async t=>{
 const p=await legacyFixture(t);p.baseline=Promise.reject(Error('PRIVATE_BASELINE_SENTINEL'));assert.equal(p.ready(),false);await new Promise(resolve=>setImmediate(resolve));
});

test('production store never treats a missing inventory as an implicitly empty baseline',linux,async t=>{
 const f=await fixture(t),store=createAdmissionStore({activationEnabled:true,dbPath:f.dbPath,relayStore:f.store.relay,now:f.now});f.trackStore(store);assert.equal(store.legacyAdmissionReady(f.binding.enrollmentId),false);assert.equal(store.hasEnrollmentUncertainty(f.binding.enrollmentId),true);
});

test('disabled baseline loader performs no I/O and enabled loader requires an explicit hash pin',()=>{
 assert.equal(createLegacyBaselineLoader({activationEnabled:false,file:'/NEVER_READ'}),null);assert.throws(()=>createLegacyBaselineLoader({activationEnabled:true,file:'/NEVER_READ'}),/legacy_review_required/);
});

function files(t){const root=fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP??'/tmp'),'picard-legacy-files-'));fs.chmodSync(root,0o750);t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const file=path.join(root,'legacy-baseline.json'),value={v:1,kind:'PICARD_LEGACY_BASELINE_V1',synthetic:true},raw=canonical(value)+'\n';fs.writeFileSync(file,raw,{mode:0o640});fs.chmodSync(file,0o640);return {root,file,value,raw,load:createLegacyBaselineLoader({activationEnabled:true,file,expectedSha256:admissionHash(raw),expectedUid:process.getuid(),expectedGid:process.getgid()})};}
test('baseline file is canonical, separately hash pinned, and cannot reload into new exceptions',linux,t=>{const p=files(t);assert.deepEqual(p.load(),p.value);fs.writeFileSync(p.file,canonical({...p.value,exception:'new'})+'\n');assert.throws(p.load,/legacy_review_required/);});
for(const mode of [0o600,0o644,0o660])test('baseline rejects unsafe or unexpected mode '+mode.toString(8),linux,t=>{const p=files(t);fs.chmodSync(p.file,mode);assert.throws(p.load,/legacy_review_required/);});
test('baseline rejects symlink, hardlink, duplicate keys and invalid UTF8',linux,t=>{const p=files(t),alias=path.join(p.root,'alias');fs.linkSync(p.file,alias);assert.throws(p.load,/legacy_review_required/);fs.unlinkSync(alias);fs.renameSync(p.file,alias);fs.symlinkSync(alias,p.file);assert.throws(p.load,/legacy_review_required/);fs.unlinkSync(p.file);fs.renameSync(alias,p.file);for(const raw of ['{"v":1,"v":1}\n',Buffer.from([255])]){fs.writeFileSync(p.file,raw);assert.throws(p.load,/legacy_review_required/);}});

test('legacy marker inventory hashes bounded files without reading unknown names or credentials',linux,t=>{
 const p=files(t),dir=path.join(p.root,'markers');fs.mkdirSync(dir,{mode:0o700});const name='one-call-consumed.json',file=path.join(dir,name),raw='SYNTHETIC_CONSUMED_ONLY';fs.writeFileSync(file,raw,{mode:0o600});
 assert.deepEqual(readLegacyAdmissionMarkers(dir,[name]),[{name,sha256:admissionHash(raw)}]);fs.writeFileSync(path.join(dir,'groq-once-new.consumed'),'NEW_ASSOCIATED_MARKER',{mode:0o600});assert.equal(readLegacyAdmissionMarkers(dir,[name]).length,1);
 fs.writeFileSync(path.join(dir,'one-call-unreviewed.json'),'MUST_NOT_READ',{mode:0o600});const original=fs.openSync;fs.openSync=()=>{throw Error('MUST_NOT_OPEN_UNKNOWN_FILE');};try{assert.throws(()=>readLegacyAdmissionMarkers(dir,[name]),e=>e.message==='legacy_review_required');}finally{fs.openSync=original;}
});

for(const failure of ['mode','hardlink','symlink','oversize','changed-during-read'])test('legacy marker boundary refuses '+failure,linux,t=>{
 const p=files(t),dir=path.join(p.root,'markers');fs.mkdirSync(dir,{mode:0o700});const name='one-call-consumed.json',file=path.join(dir,name);fs.writeFileSync(file,'SYNTHETIC_MARKER',{mode:0o600});
 if(failure==='mode')fs.chmodSync(file,0o644);if(failure==='oversize')fs.writeFileSync(file,'x'.repeat(16385));if(failure==='hardlink')fs.linkSync(file,path.join(dir,'alias'));if(failure==='symlink'){fs.renameSync(file,path.join(dir,'real'));fs.symlinkSync(path.join(dir,'real'),file);}
 const read=fs.readSync;if(failure==='changed-during-read')fs.readSync=(...args)=>{const n=read(...args);fs.appendFileSync(file,'CHANGED');return n;};
 try{assert.throws(()=>readLegacyAdmissionMarkers(dir,[name]),/legacy_review_required/);}finally{fs.readSync=read;}
});
