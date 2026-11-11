import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture,fixtureOrigin,fixtureToken} from './fixtures/workspace-fixture.mjs';
import {createWorkspaceHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createReadOnlyWorkspace,readPrivateWorkspaceSession,workspaceOrigin} from '../tools/workspace-readonly.mjs';

const cookie='__Host-PicardSession='+fixtureToken;
const session=(origin=fixtureOrigin)=>({v:1,origin,cookie,expiresAt:Date.now()+3600000});
async function setup(t){
  const fixture=await workspaceFixture({realMarkers:false});t.after(()=>fixture.close());const calls=[];
  const transport=async({origin,path,cookie:credential})=>{
    assert.equal(origin,fixtureOrigin);calls.push(path);
    const reply=await fixture.request(path,{method:'GET',headers:{cookie:credential}});
    return {status:reply.status,data:reply.body};
  };
  return {fixture,calls,client:createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport}),transport};
}
async function seed(fixture){const draft=await fixture.prepare();const proof=await fixture.approve(draft);await fixture.submit(draft,proof);return draft;}
function snapshot(fixture){
  const db=new DatabaseSync(fixture.dbPath,{readOnly:true});
  try{return db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(({name})=>({name,
    rows:db.prepare('SELECT * FROM "'+name+'"').all().sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))}));}finally{db.close();}
}

test('status, history, draft lookup and saved answer recovery use only existing GET routes',async t=>{
  const {fixture,client,calls}=await setup(t);const draft=await seed(fixture),ref=draft.payload.eventId;
  const config=await client.status();assert.equal(config.provider,'Groq');assert.equal(config.limits.paidFallback,false);
  assert.equal(config.usage.liveBillingVerified,false);
  assert.equal((await client.get({ref:draft.payload.requestId})).state,'queued');
  await fixture.dispatcher.runOnce();assert.equal(fixture.calls,1);
  const before=snapshot(fixture);
  const saved=await client.get({ref});assert.equal(saved.result.body,fixture.output);
  assert.equal(saved.result.sha256,createHash('sha256').update(fixture.output).digest('hex'));
  assert.deepEqual({...await client.get({ref:draft.payload.requestId}),observedAt:saved.observedAt},saved);
  const history=await client.list();assert.equal(history.rows[0].ref,ref);assert.ok(!JSON.stringify(history).includes(fixture.output));
  fixture.restart();assert.equal((await client.get({ref})).result.body,fixture.output);
  assert.equal(fixture.calls,1);assert.deepEqual(snapshot(fixture),before);
  assert.ok(calls.every(path=>path==='/workspace/config'||path==='/workspace/history'||/^\/workspace\/(drafts|requests)\/[a-f0-9-]+$/.test(path)));
  assert.ok(!JSON.stringify(saved).includes(fixtureToken));assert.equal(saved.readOnly,true);
});

test('uncommitted drafts are readable and unknown references cannot create records or invoke',async t=>{
  const {fixture,client}=await setup(t),draft=await fixture.prepare();const before=snapshot(fixture);
  const saved=await client.get({ref:draft.payload.requestId});assert.equal(saved.state,'draft');assert.equal(saved.resultAvailable,false);
  assert.equal(saved.request.text,draft.payload.request.text);assert.ok(!Object.hasOwn(saved,'approval'));
  assert.ok(!Object.hasOwn(saved,'payload'));assert.equal((await client.get({ref:draft.payload.eventId})).state,'draft');
  await assert.rejects(client.get({ref:'f'.repeat(64)}),/request_not_found/);
  assert.equal(fixture.calls,0);assert.deepEqual(snapshot(fixture),before);
});

test('another owner sees neither request metadata nor saved answers',async t=>{
  const {fixture}=await setup(t),draft=await seed(fixture);await fixture.dispatcher.runOnce();
  const handler=createWorkspaceHandler({enabled:true,auth:{authenticate:async()=>true},store:fixture.store,
    binding:{...fixture.binding,ownerId:'another-owner'},origins:[fixtureOrigin],now:fixture.now,
    loadPolicy:()=>fixture.policy,currentAvailability:fixture.router.availability});
  const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async({path,cookie:credential})=>{
    const req=Readable.from([]);Object.assign(req,{method:'GET',url:path,headers:{host:'fixture.invalid',origin:fixtureOrigin,cookie:credential}});
    const res={writeHead(status){this.status=status;},end(body){this.data=JSON.parse(body);}};
    await handler(req,res);return res;
  }});
  assert.deepEqual((await client.list()).rows,[]);
  await assert.rejects(client.get({ref:draft.payload.eventId}),/request_not_found/);
  assert.equal(fixture.calls,1);
});

test('history pagination uses observed opaque cursors and strips request/provider internals',async()=>{
  const paths=[],row={ref:'a'.repeat(64),title:'Only metadata',state:'completed',createdAt:1,updatedAt:2,resultAvailable:true,
    owner:'PRIVATE_OWNER',body:'PRIVATE_BODY',grant:'PRIVATE_GRANT'};
  const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async({path})=>{
    paths.push(path);return {status:200,data:{v:1,observedAt:new Date().toISOString(),rows:[row],nextCursor:path.includes('?')?null:'observed_cursor'}};
  }});
  await assert.rejects(client.list({cursor:'not_seen'}),/invalid_arguments/);assert.equal(paths.length,0);
  const first=await client.list();assert.ok(!JSON.stringify(first).includes('PRIVATE'));
  assert.equal((await client.list({cursor:first.nextCursor})).nextCursor,null);
  assert.deepEqual(paths,['/workspace/history','/workspace/history?cursor=observed_cursor']);
});

test('model arguments cannot select an owner, URL, credentials, HTTP method or write operation',async()=>{
  let calls=0;const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async()=>{calls++;}});
  for(const args of [{origin:'https://evil.invalid'},{cookie},{owner:'other'},{method:'POST'},[],null])await assert.rejects(client.status(args),/invalid_arguments/);
  for(const ref of ['../approvals','https://evil.invalid','A'.repeat(64),'a'.repeat(64)+'?owner=other'])await assert.rejects(client.get({ref}),/invalid_arguments/);
  await assert.rejects(client.get({ref:'a'.repeat(64),approve:true}),/invalid_arguments/);
  assert.equal(calls,0);
});

test('missing, expired and origin-mismatched sessions never trigger automatic login',async()=>{
  for(const value of [null,{...session(),expiresAt:1},session('https://other.invalid')]){
    let calls=0;const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>value,transport:async()=>{calls++;}});
    await assert.rejects(client.status(),/owner_sign_in_required/);assert.equal(calls,0);
  }
});

test('revocation, redirects and upstream failures return sanitized errors without retries',async()=>{
  for(const [status,code]of [[401,'owner_sign_in_required'],[403,'workspace_access_denied'],[302,'workspace_redirect_rejected'],[503,'workspace_read_failed']]){
    let calls=0;const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async()=>{calls++;return {status,data:{error:cookie}};}});
    await assert.rejects(client.status(),new RegExp(code));assert.equal(calls,1);
  }
  const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async()=>{throw Error(cookie);}});
  await assert.rejects(client.status(),{message:'workspace_read_failed'});
});

test('saved-answer hash/identity mismatch and reflected session material fail closed',async t=>{
  const {fixture,transport}=await setup(t),draft=await seed(fixture);await fixture.dispatcher.runOnce();const ref=draft.payload.eventId;
  for(const change of [v=>v.ref='b'.repeat(64),v=>v.result.sha256='0'.repeat(64),v=>{v.request.title=fixtureToken;}]){
    const client=createReadOnlyWorkspace({origin:fixtureOrigin,readSession:async()=>session(),transport:async args=>{
      const value=await transport(args);change(value.data);return value;
    }});
    await assert.rejects(client.get({ref}),/invalid_workspace_response/);
  }
});

test('review and grade histories are bounded with explicit truncation and original answer retained',async t=>{
  const {fixture,client}=await setup(t),draft=await seed(fixture);await fixture.dispatcher.runOnce();const ref=draft.payload.eventId;
  const result=(await client.get({ref})).result;
  for(let revision=0;revision<7;revision++){
    fixture.store.saveWorkspaceReview({ref,expectedRevision:revision,decision:'accepted',note:'x'.repeat(1500),resultSha256:result.sha256});
    fixture.store.saveWorkspaceGrade({ref,expectedRevision:revision,score:4,note:'Review '+revision,resultSha256:result.sha256,reviewer:{kind:'owner'}});
  }
  const saved=await client.get({ref});assert.equal(saved.result.body,fixture.output);
  for(const key of ['review','grade']){
    assert.equal(saved[key].revision,7);assert.equal(saved[key].historyTotal,7);assert.equal(saved[key].history.length,5);
    assert.equal(saved[key].historyTruncated,true);assert.equal(saved[key].latest.revision,7);
  }
});

test('origin and TLS configuration cannot disable verification or smuggle paths/credentials',()=>{
  for(const value of ['http://localhost','https://user:pass@example.test','https://example.test/path','https://example.test?x=1','https://example.test/#x'])assert.throws(()=>workspaceOrigin(value),/invalid_origin/);
  assert.equal(workspaceOrigin('https://example.test/'),'https://example.test');
  const before=process.env.NODE_TLS_REJECT_UNAUTHORIZED;process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';
  try{assert.throws(()=>workspaceOrigin(fixtureOrigin),/tls_verification_required/);}finally{if(before===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=before;}
});

test('POSIX session files require current ownership, private mode and a regular non-symlink file',{skip:process.platform==='win32'},async()=>{
  const dir=mkdtempSync(join(tmpdir(),'picard-read-session-'));const path=join(dir,'session.json');
  try{
    const value=session();writeFileSync(path,JSON.stringify(value),{mode:0o600});assert.deepEqual(await readPrivateWorkspaceSession(path),value);
    chmodSync(path,0o644);await assert.rejects(readPrivateWorkspaceSession(path),/owner_sign_in_required/);
    chmodSync(path,0o600);symlinkSync(path,join(dir,'link'));await assert.rejects(readPrivateWorkspaceSession(join(dir,'link')),/owner_sign_in_required/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
