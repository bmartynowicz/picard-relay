import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {workspaceFixture,fixtureOrigin} from '../../../test/fixtures/workspace-fixture.mjs';
import {createLocalAdmissionStore,admissionHash} from '../src/admission-store.mjs';
import {canonical} from '../src/protocol.mjs';

async function setup(t){
 const f=await workspaceFixture({realMarkers:false});t.after(()=>f.close());
 const access=f.store.createWorkspaceClient({origin:fixtureOrigin,label:'Synthetic private client label',mode:'read',lifetimeMs:3600000});
 const request=(url,extra={})=>f.request(url,{...extra,headers:{cookie:undefined,authorization:'Bearer '+access.token,...extra.headers}});
 return {f,access,request};
}
const prefix=f=>'picard-admission:v1:workspace:'+admissionHash(f.binding.ownerId)+':tool-activity:';

test('successful external reads persist sanitized operation events; console polling and failures do not',async t=>{
 const {f,access,request}=await setup(t);
 assert.deepEqual(f.store.workspaceToolActivity(),{v:1,available:true,recordingHealthy:true,events:[]});
 for(const path of ['/workspace/config','/workspace/history'])assert.equal((await f.request(path)).status,200);
 assert.equal(f.store.workspaceToolActivity().events.length,0);
 assert.equal((await request('/workspace/config')).status,200);f.advance(1);
 assert.equal((await request('/workspace/history')).status,200);f.advance(1);
 const d=await f.prepare();
 assert.equal((await request('/workspace/drafts/'+d.payload.requestId)).status,200);f.advance(1);
 assert.equal((await request('/workspace/requests/'+d.payload.eventId)).status,200);
 const activity=f.store.workspaceToolActivity();
 assert.deepEqual(activity.events.map(e=>e.operation),['request','draft','history','status']);
 for(const event of activity.events)assert.deepEqual(Object.keys(event).sort(),['at','id','kind','operation']);
 const text=JSON.stringify(activity);assert.ok(!text.includes(access.token));assert.ok(!text.includes(access.client.label));assert.ok(!text.includes(d.payload.eventId));assert.ok(!text.includes(d.payload.request.text));
 assert.equal((await request('/workspace/history?invalid=1')).status,400);
 assert.equal((await request('/workspace/requests/'+'f'.repeat(64))).status,404);
 assert.equal((await request('/workspace/clients')).status,403);
 assert.equal((await request('/workspace/config',{headers:{authorization:'Bearer invalid'}})).status,401);
 assert.equal((await request('/workspace/drafts',{body:f.brief()})).status,403);
 assert.equal(f.store.workspaceToolActivity().events.length,4);
 assert.equal(f.calls,0);assert.equal(f.store.relay.scopedStats({ownerId:f.binding.ownerId}).length,0);
 f.restart();assert.deepEqual(f.store.workspaceToolActivity(),activity);
});

test('history has a hard durable bound, independent owner namespaces, no grant/job changes',async t=>{
 const {f,access}=await setup(t),db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
 const beforeJobs=db.prepare('SELECT * FROM relay_jobs').all();
 for(let i=0;i<80;i++){f.advance(1);f.store.recordWorkspaceToolRead({clientId:access.client.id,origin:fixtureOrigin,operation:'status'});}
 const projected=f.store.workspaceToolActivity();assert.equal(projected.events.length,12);
 const rows=db.prepare('SELECT nonce FROM relay_nonces WHERE nonce GLOB ?').all(prefix(f)+'*');assert.equal(rows.length,1);
 const record=JSON.parse(Buffer.from(rows[0].nonce.slice(prefix(f).length),'base64url'));assert.equal(record.events.length,64);assert.deepEqual(record.events.slice(0,12),projected.events);
 assert.deepEqual(db.prepare('SELECT * FROM relay_jobs').all(),beforeJobs);
 const other=createLocalAdmissionStore({mode:'synthetic-integration-only',dbPath:f.dbPath,workspaceEnabled:true,reusableBinding:{ownerId:'another-owner',enrollmentId:'a'.repeat(64)},now:f.now});
 try{assert.deepEqual(other.workspaceToolActivity().events,[]);assert.throws(()=>other.recordWorkspaceToolRead({clientId:access.client.id,origin:fixtureOrigin,operation:'status'}));}finally{other.close();}
 f.store.revokeWorkspaceClient(access.client.id,fixtureOrigin);
 assert.throws(()=>f.store.recordWorkspaceToolRead({clientId:access.client.id,origin:fixtureOrigin,operation:'status'}));
 assert.equal(f.store.workspaceToolActivity().recordingHealthy,false);assert.equal(f.store.workspaceToolActivity().events.length,12);
});

test('failed telemetry commit is rolled back and surfaced without breaking a successful read',async t=>{
 const {f,request}=await setup(t),db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
 assert.equal((await request('/workspace/config')).status,200);const prior=f.store.workspaceToolActivity().events;
 db.exec("CREATE TRIGGER fail_activity BEFORE INSERT ON relay_nonces WHEN NEW.nonce LIKE '%:tool-activity:%' BEGIN SELECT RAISE(ABORT,'synthetic activity failure'); END;");
 assert.equal((await request('/workspace/history')).status,200);
 assert.deepEqual(f.store.workspaceToolActivity(),{v:1,available:true,recordingHealthy:false,events:prior});
 db.exec('DROP TRIGGER fail_activity');
 assert.equal((await request('/workspace/config')).status,200);
 assert.equal(f.store.workspaceToolActivity().recordingHealthy,false,'do not hide earlier process-local recording gaps');
 assert.equal(f.store.workspaceToolActivity().events.length,2);assert.equal(f.calls,0);
});

test('corrupt, future and cross-owner records become unavailable rather than fabricated idle history',async t=>{
 const {f,request}=await setup(t),db=new DatabaseSync(f.dbPath);t.after(()=>db.close());
 assert.equal((await request('/workspace/config')).status,200);
 const row=db.prepare('SELECT nonce,expires FROM relay_nonces WHERE nonce GLOB ?').get(prefix(f)+'*');
 const record=JSON.parse(Buffer.from(row.nonce.slice(prefix(f).length),'base64url'));
 const set=value=>{db.prepare('DELETE FROM relay_nonces WHERE nonce GLOB ?').run(prefix(f)+'*');db.prepare('INSERT INTO relay_nonces VALUES(?,?)').run(prefix(f)+Buffer.from(canonical(value)).toString('base64url'),row.expires);};
 for(const bad of [{...record,ownerId:'other'}, {...record,events:[{...record.events[0],at:f.now()+100000}]}, {...record,events:[...record.events,...record.events]}]){
  set(bad);assert.deepEqual(f.store.workspaceToolActivity(),{v:1,available:false,recordingHealthy:false,events:[]});
  assert.equal((await request('/workspace/config')).status,200);
  assert.equal(f.store.workspaceToolActivity().available,false);
 }
});
