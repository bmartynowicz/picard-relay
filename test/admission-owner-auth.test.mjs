import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {fixture,origin,syntheticLegacyBaseline} from './fixtures/admission-fixture.mjs';
import {createOwnerAuth,createBootstrapState} from '../experimental/runtime-control/src/oracle-service.mjs';
import {createAdmissionHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';
import {canonical,digest,payloadHash} from '../experimental/runtime-control/src/protocol.mjs';
const linux={skip:process.platform!=='linux'?'Requires actual Linux owner-auth and durable file metadata semantics.':false};
const password='Synthetic owner password only 8!';
async function ownerFixture(t){
 const f=await fixture(t),stateDir=path.join(f.dir,'owner-auth');fs.mkdirSync(stateDir,{mode:0o700});
 const stateFile=path.join(stateDir,'auth-state.json'),code=randomBytes(32).toString('base64url');
 fs.writeFileSync(stateFile,JSON.stringify(createBootstrapState({code,createdAt:f.now(),expiresAt:f.now()+900000})),{mode:0o600});
 const authOptions={stateDir,now:f.now},auth=createOwnerAuth(authOptions),session=await auth.setup({code,password});
 const store=createAdmissionStore({activationEnabled:true,dbPath:f.dbPath,relayStore:f.store.relay,now:f.now,legacyBinding:f.binding,loadLegacyBaseline:()=>syntheticLegacyBaseline(f),readLegacyMarkers:()=>[]});f.trackStore(store);
 const handler=(authCore=auth)=>createAdmissionHandler({activationEnabled:true,auth:authCore,store,loadPolicy:()=>f.policy,binding:f.binding,origins:[origin],now:f.now,currentAvailability:()=>({acceptingRequests:true,pendingUncertainty:false,costContradiction:false,code:'ready'})});
 const request=(url,options={})=>f.request(url,{...options,headers:{cookie:'__Host-PicardSession='+session.token,...options.headers},adapter:options.adapter??handler()});
 const challenge=async()=>{const r=await request('/request-approvals',{body:f.selection});assert.equal(r.status,200);return r.body;};
 const body=proof=>({...f.selection,nonce:proof.nonce,approvedInputSha256:f.entry.inputSha256,approve:true});
 return {...f,request,challenge,body,auth,authOptions,handler,session,stateFile,password};
}

test('actual owner session authorizes only same-origin bounded catalogue and approval routes',linux,async t=>{
 const f=await ownerFixture(t);assert.equal((await f.request('/request-catalogue',{headers:{cookie:''}})).status,401);
 assert.equal((await f.request('/request-catalogue',{headers:{cookie:'__Host-PicardSession='+f.session.token+'; __Host-PicardSession='+f.session.token}})).status,401);
 assert.equal((await f.request('/request-catalogue',{headers:{origin:'https://other.invalid'}})).status,403);
 const good=await f.request('/request-catalogue');assert.equal(good.status,200);assert.equal(good.body.mode,'enabled');assert.equal(good.body.entries.length,1);
 const proof=await f.challenge(),r=await f.request('/requests',{body:f.body(proof)});assert.equal(r.status,201);assert.equal(r.body.mode,'enabled');
 const again=await f.request('/request-approvals',{body:f.selection});assert.equal(again.body.mode,'enabled');assert.equal(again.body.existing,true);
 const all=JSON.stringify([good,r,again]);for(const secret of [f.session.token,password,'keySha256','organizationId'])assert.equal(all.includes(secret),false);
});

test('actual session rotation and restart do not transfer a nonce to another session',linux,async t=>{
 const f=await ownerFixture(t),proof=await f.challenge();const next=await f.auth.login({password});
 assert.equal((await f.request('/requests',{body:f.body(proof)})).status,401);
 const restarted=f.handler(createOwnerAuth(f.authOptions)),headers={cookie:'__Host-PicardSession='+next.token};
 assert.equal((await f.request('/requests',{body:f.body(proof),headers,adapter:restarted})).status,409);
 assert.equal(f.store.get(f.entry.slots[0].eventId),null);
 const current=await f.request('/request-approvals',{body:f.selection,headers,adapter:restarted});assert.equal(current.status,200);
 assert.equal((await f.request('/requests',{body:f.body(current.body),headers,adapter:restarted})).status,201);
});

test('actual logout and expired nonce never register a request',linux,async t=>{
 const f=await ownerFixture(t),proof=await f.challenge();await f.auth.logout(f.session.token);
 assert.equal((await f.request('/requests',{body:f.body(proof)})).status,401);assert.equal(f.store.get(f.entry.slots[0].eventId),null);
 const next=await f.auth.login({password}),headers={cookie:'__Host-PicardSession='+next.token};
 const current=await f.request('/request-approvals',{body:f.selection,headers});f.tick(60000);
 assert.equal((await f.request('/requests',{body:f.body(current.body),headers})).status,409);assert.equal(f.store.get(f.entry.slots[0].eventId),null);
});

test('saved owner result remains readable after request and catalogue expiry, without enqueueing again',linux,async t=>{
 const f=await ownerFixture(t),proof=await f.challenge(),registered=await f.request('/requests',{body:f.body(proof)}),ref=registered.body.ref;
 const claim=f.store.claimEligible({ids:[ref],workerId:'fixture',claimTtlMs:60000}),input={requestId:ref,attempt:claim.attempt,workerId:'fixture'};
 f.store.relay.startInvocation(input);f.store.relay.appendReply({...input,owner:f.catalogue.ownerId,task:f.catalogue.taskId,eventId:'resp:'+ref,kind:'answer',outcomeKind:'information',body:'SYNTHETIC_SAVED_TEXT <script>not executed</script>',statusChange:null});f.store.relay.markCompleted(input);
 const count=f.store.relay.stats();f.tick(3600001);
 assert.equal((await f.request('/request-catalogue')).status,503);
 const r=await f.request('/requests/'+ref);assert.equal(r.status,200);assert.equal(r.body.resultAvailable,true);assert.equal(r.body.result.body,'SYNTHETIC_SAVED_TEXT <script>not executed</script>');assert.equal(r.body.mayInvoke,false);assert.deepEqual(f.store.relay.stats(),count);
 assert.equal((await f.request('/requests/'+ref,{headers:{cookie:''}})).status,401);
 const db=new DatabaseSync(f.dbPath);try{db.prepare('UPDATE relay_jobs SET task=? WHERE event_id=?').run('other-task',ref);}finally{db.close();}
 const denied=await f.request('/requests/'+ref);assert.equal(denied.status,403);assert.equal(JSON.stringify(denied).includes('SYNTHETIC_SAVED_TEXT'),false);
});

test('malformed stored result and foreign-owner result never disclose saved text',linux,async t=>{
 const f=await ownerFixture(t),proof=await f.challenge(),registered=await f.request('/requests',{body:f.body(proof)}),ref=registered.body.ref;
 const db=new DatabaseSync(f.dbPath);try{db.prepare("UPDATE relay_jobs SET state='completed',result_json=? WHERE event_id=?").run(JSON.stringify({body:'PRIVATE_CORRUPT_RESULT'}),ref);}finally{db.close();}
 const corrupt=await f.request('/requests/'+ref);assert.equal(corrupt.status,409);assert.equal(JSON.stringify(corrupt).includes('PRIVATE_CORRUPT_RESULT'),false);
 const original=JSON.parse(f.store.get(ref).payload_json),foreign={...original,ownerId:'other-owner',requestId:randomBytes(16).toString('hex')};foreign.eventId=await digest(canonical([foreign.ownerId,foreign.taskId,foreign.requestId]));foreign.payloadHash=await payloadHash(foreign);await f.store.relay.accept(foreign);
 const denied=await f.request('/requests/'+foreign.eventId);assert.equal(denied.status,403);assert.equal(JSON.stringify(denied).includes(foreign.ownerId),false);
});
