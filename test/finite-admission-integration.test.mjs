// No listener or provider. Real disposable SQLite plus request/response harness.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../experimental/runtime-control/src/protocol.mjs';
import {createLocalAdmissionStore} from '../experimental/finite-admission/local-store.mjs';
import {createLocalAdmissionHandler} from '../experimental/finite-admission/local-handler.mjs';

const token='A'.repeat(43),otherToken='B'.repeat(43),origin='https://fixture.invalid';
async function fixture(t,{slots=2}={}){
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-admission-test-'));fs.writeFileSync(path.join(dir,'fixture-only.marker'),'PICARD_SYNTHETIC_ADMISSION_ONLY\n');
 let at=Date.now(),faultCommitNumber=null,commits=0,failResponse=false,authCalls=0,policyReads=0,activeToken=token,available={acceptingRequests:true,pendingUncertainty:false,costContradiction:false};const extraStores=[];
 const enrollment={v:1,owner:'fixture-owner',provider:'groq',model:'openai/gpt-oss-20b',accountLabel:'Synthetic integration',organizationId:'fixture-org',projectId:'fixture-project',keySha256:'a'.repeat(64),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-86400000,enrolledAt:at-10000,evidenceRef:'SYNTHETIC_RETAINED',keyAssociationEvidenceRef:'SYNTHETIC_KEY_ASSOCIATION'};
 const taskId='fixture-task',requestText='Propose a synthetic literal.',taskContext={title:'Synthetic only',nextAction:'No provider',latestFinding:'No live data'};
 const entry={entryId:'literal',purpose:'sanitized-source-proposal',requestText,taskContext,inputSha256:await digest(canonical({requestText,taskContext})),slots:[]};
 for(let i=0;i<slots;i++){const requestId=randomUUID();entry.slots.push({slotId:'slot-'+i,requestId,grantId:randomUUID(),eventId:await digest(canonical([enrollment.owner,taskId,requestId]))});}
 const catalogue={v:1,kind:'FINITE_ADMISSION_PROTOTYPE_ONLY',ownerId:enrollment.owner,taskId,assistantId:'groq:'+enrollment.model,enrollmentId:await digest(canonical(enrollment)),notBefore:at-1000,expiresAt:at+3600000,maxRequestLifetimeMs:600000,entries:[entry]};
 const binding={ownerId:catalogue.ownerId,taskId,assistantId:catalogue.assistantId,enrollmentId:catalogue.enrollmentId,keySha256:enrollment.keySha256,configurationSha256:'b'.repeat(64)};
 const policy={v:1,catalogue,costEnrollment:enrollment,configurationSha256:binding.configurationSha256};
 const dbPath=path.join(dir,'admission-fixture.sqlite');let store;
 const open=()=>createLocalAdmissionStore({mode:'synthetic-integration-only',dbPath,now:()=>at,beforeCommit:()=>{commits++;if(commits===faultCommitNumber)throw Error('PRIVATE_DISK_SENTINEL');}});
 store=open();
 const handler=(targetStore=store)=>createLocalAdmissionHandler({mode:'synthetic-integration-only',store:targetStore,auth:{authenticate:async value=>{authCalls++;return value===activeToken;}},loadPolicy:()=>{policyReads++;return policy;},binding,origins:[origin],now:()=>at,currentAvailability:()=>available,afterCommit:()=>{if(failResponse)throw Error('PRIVATE_RESPONSE_SENTINEL');}});
 async function request(url,{body,raw,headers={},method=body===undefined&&raw===undefined?'GET':'POST',adapter=handler()}={}){
  const input=raw===undefined?(body===undefined?[]:[Buffer.from(canonical(body))]):[Buffer.isBuffer(raw)?raw:Buffer.from(raw)];const req=Readable.from(input);Object.assign(req,{url,method,headers:{host:'fixture.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'__Host-PicardSession='+token,...headers}});
  let status=null,responseHeaders=null,responseBody=null;const res={writeHead(s,h){status=s;responseHeaders=h;},end(b){responseBody=b;}};const handled=await adapter(req,res);return {handled,status,headers:responseHeaders,body:responseBody===null?null:JSON.parse(responseBody)};
 }
 const selection={entryId:entry.entryId,slotId:entry.slots[0].slotId};
 const challenge=async(selected=selection)=>{const r=await request('/request-approvals',{body:selected});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const submit=async(c,extra={})=>request('/requests',{body:{...selection,nonce:c.nonce,approvedInputSha256:entry.inputSha256,approve:true,...extra}});
 t.after(()=>{for(const extra of extraStores)extra.close();store.close();fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,dbPath,request,challenge,submit,selection,entry,catalogue,policy,enrollment,binding,get store(){return store;},now:()=>at,tick:ms=>at+=ms,availability:v=>available=v,breakResponse:()=>failResponse=true,fixResponse:()=>failResponse=false,rotateSession:()=>activeToken=otherToken,faultAt:n=>faultCommitNumber=n,get commits(){return commits;},get authCalls(){return authCalls;},get policyReads(){return policyReads;},restart:()=>{store.close();store=open();},independentHandler:()=>{const second=open();extraStores.push(second);return handler(second);}};
}

test('production activation and arbitrary database paths are rejected before schema access',()=>{
 assert.throws(()=>createLocalAdmissionStore({mode:'production',dbPath:'/production.sqlite'}),/production_admission_disabled/);
 assert.throws(()=>createLocalAdmissionStore({mode:'synthetic-integration-only',dbPath:'/production.sqlite'}),/fixture_storage_required/);
 assert.throws(()=>createLocalAdmissionHandler({mode:'production'}),/production_admission_disabled/);
});
test('authenticated catalogue is synthetic, bounded, exact and contains no enrollment/session/key fields',async t=>{
 const f=await fixture(t),r=await f.request('/request-catalogue');assert.equal(r.status,200);assert.equal(r.body.mayInvoke,false);assert.equal(r.body.admissionReady,false);assert.equal(r.body.policy.totalSlots,2);assert.equal(r.body.entries[0].requestText,f.entry.requestText);assert.equal(JSON.stringify(r.body).includes(token),false);for(const key of ['keySha256','organizationId','evidenceRef','ownerId','grantId','requestId'])assert.equal(JSON.stringify(r.body).includes(key),false);assert.equal(r.headers['Cache-Control'],'no-store, private');
});
for(const headers of [{cookie:''},{cookie:'__Host-PicardSession=bad'},{cookie:'__Host-PicardSession='+otherToken},{cookie:'__Host-PicardSession='+token+'; __Host-PicardSession='+token}])test('missing, wrong-owner or duplicate session fails before private policy reads: '+headers.cookie.slice(-6),async t=>{
 const f=await fixture(t),r=await f.request('/request-catalogue',{headers});assert.equal(r.status,401);assert.equal(f.policyReads,0);
});
for(const headers of [{host:'evil.invalid'},{origin:'https://evil.invalid'},{origin:undefined},{'sec-fetch-site':'cross-site'},{host:'fixture.invalid@evil.invalid'}])test('Host/Origin/CSRF boundary fails before authentication and approval writes: '+JSON.stringify(headers),async t=>{
 const f=await fixture(t),r=await f.request('/request-approvals',{body:f.selection,headers});assert.equal(r.status,403);assert.equal(f.authCalls,0);assert.equal(f.policyReads,0);
});
for(const url of ['/requests?x=1','/requests/','/%72equests','https://fixture.invalid/requests','/request-catalogue?owner=other'])test('alternate path is not admitted: '+url,async t=>{const f=await fixture(t);assert.equal((await f.request(url,{body:{}})).handled,false);assert.equal(f.authCalls,0);});
test('nonce binds session/catalogue/slot/input and consumed request persists across restart',async t=>{
 const f=await fixture(t),c=await f.challenge(),first=await f.submit(c);assert.equal(first.status,201);assert.equal(first.body.mayInvoke,false);const before=f.store.get(first.body.ref);assert.equal(before.state,'queued');assert.equal(before.attempt,0);f.tick(70000);f.restart();const duplicate=await f.submit(c);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);const after=f.store.get(first.body.ref);assert.equal(after.payload_json,before.payload_json);assert.equal(after.grant_expires,before.grant_expires);assert.equal(after.attempt,0);
});
test('concurrent repeated clicks and independent database connections create exactly one immutable job',async t=>{
 const f=await fixture(t),c=await f.challenge();const replies=await Promise.all([f.submit(c),f.request('/requests',{adapter:f.independentHandler(),body:{...f.selection,nonce:c.nonce,approvedInputSha256:f.entry.inputSha256,approve:true}}),f.submit(c)]);assert.equal(replies.filter(r=>r.status===201).length,1);assert.equal(replies.filter(r=>r.body.duplicate).length,2);const db=new DatabaseSync(f.dbPath);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relay_jobs').get().n,1);db.close();assert.equal(f.store.get(replies[0].body.ref).attempt,0);
});
for(const change of [{slotId:'slot-1'},{approvedInputSha256:'f'.repeat(64)},{nonce:'Z'.repeat(43)},{approve:false},{requestText:'arbitrary'},{ownerId:'other'},{grantId:'injected'}])test('approval cannot inject or substitute request authority: '+JSON.stringify(change),async t=>{const f=await fixture(t),c=await f.challenge(),r=await f.submit(c,change);assert.ok([400,409].includes(r.status));assert.equal(f.store.get(f.entry.slots[0].eventId),null);});
test('changed owner/task/enrollment/key/project/configuration invalidates retained policy',async t=>{
 for(const mutate of [f=>f.catalogue.ownerId='other',f=>f.catalogue.taskId='other',f=>f.policy.configurationSha256='c'.repeat(64),f=>f.enrollment.keySha256='c'.repeat(64),f=>f.enrollment.projectId='other',f=>f.enrollment.accountPlan='Paid']){
  const f=await fixture(t);mutate(f);const r=await f.request('/request-catalogue');assert.equal(r.status,503);assert.equal(r.body.error,'admission_unavailable');
 }
});
test('nonce expires exactly and cannot renew original grant or admit another slot',async t=>{const f=await fixture(t),c=await f.challenge();f.tick(60000);const r=await f.submit(c);assert.equal(r.status,409);assert.equal(f.store.get(f.entry.slots[0].eventId),null);});
test('policy/clock expiry and unavailable/uncertain/billing contradiction fail closed',async t=>{
 for(const value of [{acceptingRequests:false,pendingUncertainty:false,costContradiction:false},{acceptingRequests:true,pendingUncertainty:true,costContradiction:false},{acceptingRequests:true,pendingUncertainty:false,costContradiction:true},{}]){
  const f=await fixture(t);f.availability(value);const r=await f.request('/request-approvals',{body:f.selection});assert.equal(r.status,503);assert.equal(f.store.get(f.entry.slots[0].eventId),null);
 }
});
test('availability is rechecked inside final transaction after approval was issued',async t=>{const f=await fixture(t),c=await f.challenge();f.availability({acceptingRequests:true,pendingUncertainty:true,costContradiction:false});assert.equal((await f.submit(c)).status,503);assert.equal(f.store.get(f.entry.slots[0].eventId),null);});
test('owner-wide persistent rate budget counts malformed POSTs and survives restart',async t=>{
 const f=await fixture(t);for(let i=0;i<10;i++)assert.equal((await f.request('/request-approvals',{raw:'not-json'})).status,400);f.restart();assert.equal((await f.request('/request-approvals',{body:f.selection})).status,429);f.tick(60000);assert.equal((await f.request('/request-approvals',{body:f.selection})).status,200);
});
test('failed atomic commit cannot leave a used nonce, erase evidence or claim admission',async t=>{
 const f=await fixture(t),c=await f.challenge();f.faultAt(f.commits+2);const r=await f.submit(c);assert.equal(r.status,503);assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);assert.equal(f.store.get(f.entry.slots[0].eventId),null);f.faultAt(null);f.restart();assert.equal((await f.submit(c)).status,201);
});
test('lost response after committed admission recovers original row without replacement',async t=>{
 const f=await fixture(t),c=await f.challenge();f.breakResponse();assert.equal((await f.submit(c)).status,503);const row=f.store.get(f.entry.slots[0].eventId);assert.ok(row);f.fixResponse();f.tick(1000);f.restart();const r=await f.submit(c);assert.equal(r.status,200);assert.equal(r.body.duplicate,true);assert.equal(f.store.get(row.event_id).payload_json,row.payload_json);
});
test('revoked slot and used-proof-with-missing-job cannot recreate or invoke',async t=>{
 const f=await fixture(t),c=await f.challenge();f.store.relay.cancel(f.catalogue.ownerId,f.catalogue.taskId,f.entry.slots[0].grantId);assert.equal((await f.submit(c)).status,409);assert.equal(f.store.get(f.entry.slots[0].eventId),null);
 const g=await fixture(t),d=await g.challenge();assert.equal((await g.submit(d)).status,201);const db=new DatabaseSync(g.dbPath);db.prepare('DELETE FROM relay_jobs WHERE event_id=?').run(g.entry.slots[0].eventId);db.close();assert.equal((await g.submit(d)).status,409);assert.equal(g.store.get(g.entry.slots[0].eventId),null);
});

test('a rotated authenticated session cannot reuse a prior session approval nonce',async t=>{
 const f=await fixture(t),c=await f.challenge();f.rotateSession();const r=await f.request('/requests',{headers:{cookie:'__Host-PicardSession='+otherToken},body:{...f.selection,nonce:c.nonce,approvedInputSha256:f.entry.inputSha256,approve:true}});assert.equal(r.status,409);assert.equal(f.store.get(f.entry.slots[0].eventId),null);
});
for(const field of ['owner','task'])test('reused database cannot expose another '+field+' slot status',async t=>{
 const f=await fixture(t),c=await f.challenge();assert.equal((await f.submit(c)).status,201);const db=new DatabaseSync(f.dbPath);db.prepare('UPDATE relay_jobs SET '+field+'=? WHERE event_id=?').run('PRIVATE_OTHER_SCOPE',f.entry.slots[0].eventId);db.close();for(const [url,body] of [['/request-catalogue',undefined],['/request-approvals',f.selection]]){const r=await f.request(url,{body});assert.equal(r.status,409);assert.equal(JSON.stringify(r).includes('PRIVATE_'),false);}
});
for(const state of ['completed','uncertain','failed'])test('existing '+state+' slot recovers without new approval or renewed grant, even while new work is blocked',async t=>{
 const f=await fixture(t),c=await f.challenge();assert.equal((await f.submit(c)).status,201);const first=f.store.get(f.entry.slots[0].eventId),db=new DatabaseSync(f.dbPath);db.prepare('UPDATE relay_jobs SET state=? WHERE event_id=?').run(state,first.event_id);db.close();f.availability({acceptingRequests:false,pendingUncertainty:true,costContradiction:false});f.tick(70000);const r=await f.submit(c);assert.equal(r.status,200);assert.equal(r.body.state,state);assert.equal(r.body.duplicate,true);const after=f.store.get(first.event_id);assert.equal(after.grant_expires,first.grant_expires);assert.equal(after.payload_json,first.payload_json);assert.equal(after.attempt,0);
});
for(const raw of ['{"entryId":"literal","entryId":"literal","slotId":"slot-0"}',' '.repeat(1025),Buffer.from([0xff]),'[]'])test('duplicate keys, oversized and malformed approval bodies are rejected: '+String(raw).slice(0,20),async t=>{const f=await fixture(t),r=await f.request('/request-approvals',{raw});assert.ok([400,413].includes(r.status));assert.equal(f.store.get(f.entry.slots[0].eventId),null);});

test('expired unused approval cleanup preserves legacy nonce and all job rows',async t=>{
 const f=await fixture(t);await f.challenge();const db=new DatabaseSync(f.dbPath);db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run('LEGACY_UNRELATED_NONCE',f.now()-1000);db.close();f.tick(60000);await f.challenge();const check=new DatabaseSync(f.dbPath);assert.ok(check.prepare('SELECT 1 FROM relay_nonces WHERE nonce=?').get('LEGACY_UNRELATED_NONCE'));check.close();
});

test('catalogue removed while request body arrives cannot register from the earlier snapshot',async t=>{
 const f=await fixture(t),c=await f.challenge(),event=f.entry.slots[0].eventId;
 const actual=createLocalAdmissionHandler({mode:'synthetic-integration-only',store:f.store,auth:{authenticate:async value=>value===token},loadPolicy:()=>f.policy,binding:f.binding,origins:[origin],now:f.now,currentAvailability:()=>({acceptingRequests:true,pendingUncertainty:false,costContradiction:false})});
 const delayed=(req,res)=>{const stream=Readable.from((async function*(){f.catalogue.entries=[];for await(const chunk of req)yield chunk;})());Object.assign(stream,{url:req.url,method:req.method,headers:req.headers});return actual(stream,res);};
 const response=await f.request('/requests',{body:{...f.selection,nonce:c.nonce,approvedInputSha256:f.entry.inputSha256,approve:true},adapter:delayed});assert.equal(response.status,503);assert.equal(f.store.get(event),null);
 const db=new DatabaseSync(f.dbPath);try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relay_nonces WHERE nonce GLOB ?').get('picard-admission:v1:enrollment:*').n,0);}finally{db.close();}
});

test('policy is rechecked inside transaction after the availability callback, not merely before awaiting the body',async t=>{
 const f=await fixture(t),c=await f.challenge(),event=f.entry.slots[0].eventId;
 const actual=createLocalAdmissionHandler({mode:'synthetic-integration-only',store:f.store,auth:{authenticate:async value=>value===token},loadPolicy:()=>f.policy,binding:f.binding,origins:[origin],now:f.now,currentAvailability:()=>{f.catalogue.entries=[];return {acceptingRequests:true,pendingUncertainty:false,costContradiction:false};}});
 const response=await f.request('/requests',{body:{...f.selection,nonce:c.nonce,approvedInputSha256:f.entry.inputSha256,approve:true},adapter:actual});assert.equal(response.status,503);assert.equal(f.store.get(event),null);
});

test('asynchronous policy readers fail closed because they cannot revalidate within an atomic commit',async t=>{
 const f=await fixture(t),actual=createLocalAdmissionHandler({mode:'synthetic-integration-only',store:f.store,auth:{authenticate:async value=>value===token},loadPolicy:async()=>f.policy,binding:f.binding,origins:[origin],now:f.now});
 assert.equal((await f.request('/request-catalogue',{adapter:actual})).status,503);assert.equal(f.store.relay.stats().length,0);
});

test('failed registration transaction leaves no durable enrollment association',async t=>{
 const f=await fixture(t),c=await f.challenge();f.faultAt(f.commits+2);assert.equal((await f.submit(c)).status,503);
 const db=new DatabaseSync(f.dbPath);try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM relay_nonces WHERE nonce GLOB ?').get('picard-admission:v1:enrollment:*').n,0);}finally{db.close();}
 assert.equal(f.store.hasEnrollmentUncertainty(f.catalogue.enrollmentId),false);
});
