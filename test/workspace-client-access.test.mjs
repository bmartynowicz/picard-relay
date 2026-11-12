import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {workspaceFixture,fixtureOrigin,fixtureToken} from './fixtures/workspace-fixture.mjs';

async function setup(t){const f=await workspaceFixture({realMarkers:false});t.after(()=>f.close());return f;}
async function enroll(f,mode='approved-work',lifetimeMs=3600000){
 const r=await f.request('/workspace/clients',{body:{label:'Coding tool',mode,lifetimeMs}});
 assert.equal(r.status,201);assert.equal(JSON.stringify(r.body.client).includes(r.body.token),false);return r.body;
}
const asClient=c=>({cookie:undefined,authorization:'Bearer '+c.token});
const approve=(f,c,d)=>f.request('/workspace/client-approvals',{body:{clientId:c.client.id,requestId:d.payload.requestId,draftSha256:d.draftSha256}});
const submit=(f,c,d,p,patch={})=>f.request('/workspace/requests',{headers:asClient(c),body:{requestId:d.payload.requestId,draftSha256:d.draftSha256,nonce:p.nonce,approve:true,...patch}});

test('independent client survives browser rotation and restart; exact approved task runs once and saved result recovers',async t=>{
 const f=await setup(t),c=await enroll(f);
 const prepared=await f.request('/workspace/drafts',{headers:asClient(c),body:f.brief()});assert.equal(prepared.status,201);
 const d=prepared.body.draft;
 assert.equal((await submit(f,c,d,{nonce:'A'.repeat(43)})).status,409);assert.equal(f.calls,0);
 const proof=await approve(f,c,d);assert.equal(proof.status,200);
 assert.equal((await submit(f,c,d,proof.body,{draftSha256:'c'.repeat(64)})).status,409);
 f.rotateSession();f.restart();
 assert.equal((await f.request('/workspace/config')).status,401);
 assert.equal((await f.request('/workspace/config',{headers:asClient(c)})).status,200);
 assert.equal((await submit(f,c,d,proof.body)).status,201);
 f.restart();await f.dispatcher.runOnce();assert.equal(f.calls,1);
 assert.equal((await submit(f,c,d,proof.body)).body.duplicate,true);
 await f.dispatcher.runOnce();assert.equal(f.calls,1);
 f.restart();const saved=await f.request('/workspace/requests/'+d.payload.eventId,{headers:asClient(c)});
 assert.equal(saved.body.result.body,f.output);assert.equal(f.calls,1);
 assert.equal(readFileSync(f.dbPath).includes(Buffer.from(c.token)),false);
});

test('owner-only approval, management and review cannot be called by a tool; read mode cannot prepare or submit',async t=>{
 const f=await setup(t),c=await enroll(f),reader=await enroll(f,'read'),d=await f.prepare();
 for(const url of ['/workspace/clients','/workspace/approvals','/workspace/client-approvals','/workspace/reviews/'+d.payload.eventId,'/workspace/grades/'+d.payload.eventId]){
  assert.equal((await f.request(url,{headers:asClient(c),body:{}})).status,403,url);
 }
 assert.equal((await f.request('/workspace/clients',{headers:asClient(c)})).status,403);
 assert.equal((await f.request('/workspace/drafts',{headers:asClient(reader),body:f.brief()})).status,403);
 assert.equal((await f.request('/workspace/requests',{headers:asClient(reader),body:{}})).status,403);
 assert.equal((await f.request('/workspace/config',{headers:asClient(reader)})).status,200);
 assert.equal((await f.request('/workspace/config',{headers:{...asClient(c),cookie:'__Host-PicardSession='+fixtureToken}})).status,401);
 assert.equal((await f.request('/workspace/config',{headers:{cookie:undefined,authorization:'Bearer '+c.token.slice(0,-1)+'!'}})).status,401);
 const listed=await f.request('/workspace/clients');assert.equal(listed.body.clients.length,2);
 assert.ok(!JSON.stringify(listed).includes(c.token));assert.ok(!JSON.stringify(listed).includes('tokenSha256'));assert.equal(f.calls,0);
});

test('approvals are bound to one client, exact input, configuration and expiry',async t=>{
 const f=await setup(t),c=await enroll(f),other=await enroll(f),d=await f.prepare(),otherDraft=await f.prepare();
 assert.equal((await approve(f,c,{...d,draftSha256:'d'.repeat(64)})).status,409);
 const p=(await approve(f,c,d)).body;
 assert.equal((await submit(f,other,d,p)).status,409);
 assert.equal((await submit(f,c,otherDraft,p)).status,409);
 f.advance(60001);assert.equal((await submit(f,c,d,p)).status,409);assert.equal(f.calls,0);
 const p2=(await approve(f,c,d)).body;
 f.binding.configurationSha256='e'.repeat(64);assert.notEqual((await submit(f,c,d,p2)).status,201);assert.equal(f.calls,0);
});

test('revocation persists, expiration and clock rollback deny access; owner browser stays valid',async t=>{
 const f=await setup(t),c=await enroll(f),d=await f.prepare(),p=(await approve(f,c,d)).body;
 assert.equal((await f.request('/workspace/clients/'+c.client.id+'/revoke',{body:{}})).status,200);f.restart();
 assert.equal((await f.request('/workspace/config',{headers:asClient(c)})).status,401);
 assert.equal((await submit(f,c,d,p)).status,401);
 assert.equal((await f.request('/workspace/config')).status,200);
 const expiring=await enroll(f,'read',60000);f.advance(60000);
 assert.equal((await f.request('/workspace/config',{headers:asClient(expiring)})).status,401);
 const rollback=await enroll(f);f.advance(1000);assert.equal((await f.request('/workspace/config',{headers:asClient(rollback)})).status,200);
 f.advance(-2000);assert.equal((await f.request('/workspace/config',{headers:asClient(rollback)})).status,401);assert.equal(f.calls,0);
});

test('lost submission response and uncertain provider outcome never cause another invocation',async t=>{
 const f=await setup(t),c=await enroll(f),d=await f.prepare(),p=(await approve(f,c,d)).body;
 f.loseResponse();assert.equal((await submit(f,c,d,p)).status,503);f.loseResponse(false);
 assert.equal((await f.request('/workspace/drafts/'+d.payload.requestId,{headers:asClient(c)})).body.registered,true);
 f.setMode('uncertain');await f.dispatcher.runOnce();assert.equal(f.calls,1);f.restart();
 assert.equal((await submit(f,c,d,p)).body.duplicate,true);await f.dispatcher.runOnce();assert.equal(f.calls,1);
 assert.equal((await f.request('/workspace/requests/'+d.payload.eventId,{headers:asClient(c)})).body.state,'uncertain');
});

test('enrollment and approval require recent owner sign-in and exact origin',async t=>{
 const f=await workspaceFixture({realMarkers:false,auth:{authenticate:async(token,options)=>token===fixtureToken&&!options?.fresh}});t.after(()=>f.close());
 assert.equal((await f.request('/workspace/clients',{body:{label:'Coding tool',mode:'read',lifetimeMs:60000}})).status,401);
 assert.equal((await f.request('/workspace/config',{headers:{origin:'https://other.invalid'}})).status,403);
 assert.equal((await f.request('/workspace/clients',{body:{},headers:{origin:undefined}})).status,403);
 assert.equal(f.store.listWorkspaceClients(fixtureOrigin).length,0);
});

test('credentials cannot cross owners or origins, and revocation during body upload wins before commit',async t=>{
 const f=await setup(t),other=await setup(t),c=await enroll(f),d=await f.prepare(),p=(await approve(f,c,d)).body;
 assert.equal((await other.request('/workspace/config',{headers:asClient(c)})).status,401);
 assert.throws(()=>f.store.authenticateWorkspaceClient(c.token,'https://other.invalid'),/auth_failed/);
 const req=Readable.from((async function*(){
  await f.request('/workspace/clients/'+c.client.id+'/revoke',{body:{}});
  yield Buffer.from(JSON.stringify({requestId:d.payload.requestId,draftSha256:d.draftSha256,nonce:p.nonce,approve:true}));
 })());
 Object.assign(req,{url:'/workspace/requests',method:'POST',headers:{host:'fixture.invalid',origin:fixtureOrigin,'content-type':'application/json',...asClient(c)}});
 const res={writeHead(status){this.status=status;},end(text){this.body=JSON.parse(text);}};
 await f.handler(req,res);assert.equal(res.status,401);assert.equal(f.store.get(d.payload.eventId),null);assert.equal(f.calls,0);
});

test('Linux durable invocation markers survive a client handoff and restart',{skip:process.platform!=='linux'},async t=>{
 const f=await workspaceFixture();t.after(()=>f.close());const c=await enroll(f),d=await f.prepare(),p=(await approve(f,c,d)).body;
 assert.equal((await submit(f,c,d,p)).status,201);await f.dispatcher.runOnce();assert.equal(f.calls,1);f.restart();
 assert.equal((await submit(f,c,d,p)).body.duplicate,true);await f.dispatcher.runOnce();assert.equal(f.calls,1);
 assert.equal((await f.request('/workspace/requests/'+d.payload.eventId,{headers:asClient(c)})).body.result.body,f.output);
});
