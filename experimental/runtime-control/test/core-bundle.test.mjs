import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {createRelayStore,recentJobReason} from '../src/relay-store.mjs';
import {consoleJobsSnapshot,createConsoleHandler} from '../src/oracle-service.mjs';
import {createReceiver} from '../src/receiver.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {canonical,digest,payloadHash,signRequest,verifyResponse} from '../src/protocol.mjs';
const SECRET='SYNTHETIC_PRIVATE_SENTINEL',hex=s=>createHash('sha256').update(s).digest('hex');
const fixture=async fn=>{const dir=mkdtempSync(join(tmpdir(),'picard-core-')),path=join(dir,'db.sqlite');let store=createRelayStore({dbPath:path});const db=new DatabaseSync(path);const insert=(owner,task,i,patch={})=>{
 const ref=hex(owner+task+i),row={ref,state:'completed',created:1000+Math.floor(i/2),updated:2000+i,error:null,...patch};
 db.prepare('INSERT INTO relay_jobs(event_id,owner,task,message_id,grant_id,grant_expires,payload_hash,payload_json,state,created_at,updated_at,last_error,response_id,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.ref,owner,task,'message-'+task+i,'grant-'+i,999999,hex('payload'),SECRET,row.state,row.created,row.updated,row.error,'response-'+i,JSON.stringify({body:SECRET}));return row.ref;
 };try{await fn({get store(){return store;},db,insert,reopen(){store.close();store=createRelayStore({dbPath:path});return store;}});}finally{store.close();db.close();rmSync(dir,{recursive:true,force:true});}};
test('recent jobs filter owner AND configured task, including reused databases',()=>fixture(async f=>{
 const a=f.insert('owner-a','task-a',0),b=f.insert('owner-a','task-b',1);f.insert('owner-b','task-a',2);
 assert.deepEqual(f.store.recentJobs({ownerId:'owner-a',allowedTaskId:'task-a'}).rows.map(r=>r.ref),[a]);assert.deepEqual(f.reopen().recentJobs({ownerId:'owner-a',allowedTaskId:'task-b'}).rows.map(r=>r.ref),[b]);assert.equal(f.store.recentJobs({ownerId:'owner-a'}).rows.length,2);assert.throws(()=>f.store.recentJobs({}));assert.throws(()=>f.store.recentJobs({ownerId:''}));
}));
test('bounded keyset pagination is stable across tied timestamps and read-only',()=>fixture(async f=>{
 for(let i=0;i<61;i++)f.insert('owner-a','task-a',i);const before=f.db.prepare('SELECT * FROM relay_jobs ORDER BY event_id').all();
 const first=f.store.recentJobs({ownerId:'owner-a',allowedTaskId:'task-a'}),seen=new Set(first.rows.map(r=>r.ref));assert.equal(first.rows.length,25);assert.ok(first.nextCursor);let cursor=first.nextCursor;
 while(cursor){const page=f.store.recentJobs({ownerId:'owner-a',allowedTaskId:'task-a',cursor});for(const row of page.rows){assert.equal(seen.has(row.ref),false);seen.add(row.ref);}cursor=page.nextCursor;}assert.equal(seen.size,61);assert.equal(f.store.recentJobs({ownerId:'owner-a',limit:50}).rows.length,50);assert.deepEqual(f.db.prepare('SELECT * FROM relay_jobs ORDER BY event_id').all(),before);
 for(const limit of [0,51,-1,'25',1.5,Infinity])assert.throws(()=>f.store.recentJobs({ownerId:'owner-a',limit}));
}));
test('cursor identity is scoped and hostile cursor/query input never broadens access',()=>fixture(async f=>{
 for(let i=0;i<3;i++){f.insert('owner-a','task-a',i);f.insert('owner-b','task-a',i);f.insert('owner-a','task-b',i);}
 const cursor=f.store.recentJobs({ownerId:'owner-a',allowedTaskId:'task-a',limit:1}).nextCursor;
 for(const query of [{ownerId:'owner-b',allowedTaskId:'task-a'},{ownerId:'owner-a',allowedTaskId:'task-b'}])assert.throws(()=>f.store.recentJobs({...query,cursor}));
 for(const value of ['',SECRET,'x'.repeat(257),'a/../../db',Buffer.from(JSON.stringify({v:1,ref:hex('bad'),createdAt:0})).toString('base64url'),Buffer.from('null').toString('base64url')])assert.throws(()=>f.store.recentJobs({ownerId:'owner-a',cursor:value}));
}));
test('history projects only bounded metadata and handles hostile/malformed rows truthfully',()=>fixture(async f=>{
 f.insert('owner-a','task-a',1,{state:'uncertain',error:JSON.stringify({v:1,code:'groq_outcome_uncertain',diagnostic:{phase:'parse',code:'json_parse_failed',body:SECRET}})});f.insert('owner-a','task-a',2,{state:'<img '+SECRET+'>',updated:SECRET});
 const page=f.store.recentJobs({ownerId:'owner-a'});assert.doesNotMatch(JSON.stringify(page),new RegExp(SECRET+'|owner-a|task-a|message-|grant-|response-'));assert.equal(page.rows.find(r=>r.state==='uncertain').reasonCode,'outcome_uncertain');const unknown=page.rows.find(r=>r.state==='unknown');assert.equal(unknown.updatedAt,null);assert.equal(unknown.reasonCode,'unknown');assert.equal(unknown.resultAvailable,false);
 const result=consoleJobsSnapshot({...page,secret:SECRET,rows:page.rows.map(r=>({...r,secret:SECRET}))},new Date(3000));assert.doesNotMatch(JSON.stringify(result),new RegExp(SECRET));assert.ok(Buffer.byteLength(JSON.stringify(result))<=16384);
 f.insert('owner-a','task-a',3,{ref:SECRET});assert.throws(()=>f.store.recentJobs({ownerId:'owner-a'}));
}));
test('empty history is truthful and never invents missing results or safe retry',()=>fixture(async f=>{
 assert.deepEqual(f.store.recentJobs({ownerId:'owner-a'}),{rows:[],nextCursor:null});
 assert.equal(recentJobReason('uncertain','scope_expired',false),'outcome_uncertain');assert.equal(recentJobReason('failed','groq_outcome_uncertain',false),'outcome_uncertain');assert.equal(recentJobReason('completed',null,false),'result_missing');assert.equal(recentJobReason('blocked','groq_quota_exhausted',false),'provider_quota');assert.equal(recentJobReason('blocked','groq_payment_required',false),'provider_payment');
}));
const token='A'.repeat(43),origin='https://relay.example';
async function request(path,{cookie=`__Host-PicardSession=${token}`,headers={},jobs=()=>({rows:[],nextCursor:null}),enabled=true}={}){
 const h=createConsoleHandler({enabled,html:'<p>console</p>',origins:[origin],auth:{authenticate:async value=>value===token},getRecentJobs:jobs}),req=Readable.from([]);Object.assign(req,{method:'GET',url:path,headers:{host:'relay.example',cookie,...headers}});const res={writeHead(status,headers){this.status=status;this.headers=headers;return this;},end(body){this.body=body;}};return {handled:await h(req,res),...res};
}
test('jobs authenticate before private reads and inherit no-store same-origin boundary',async()=>{
 for(const cookie of ['',`__Host-PicardSession=bad`,`__Host-PicardSession=${token};__Host-PicardSession=${token}`]){let called=false;const r=await request('/jobs',{cookie,jobs:()=>{called=true;}});assert.equal(r.status,401);assert.equal(called,false);}
 for(const headers of [{host:'evil.example'},{origin:'https://evil.example'},{'sec-fetch-site':'cross-site'}]){let called=false;const r=await request('/jobs',{headers,jobs:()=>{called=true;}});assert.equal(r.status,403);assert.equal(called,false);}
 const r=await request('/jobs?limit=2');assert.equal(r.status,200);assert.equal(r.headers['Cache-Control'],'no-store, private');assert.equal(JSON.parse(r.body).rows.length,0);assert.equal((await request('/jobs',{enabled:false})).handled,false);
});
test('strict history query is bounded and private failures are sanitized',async()=>{
 for(const path of ['/jobs?limit=0','/jobs?limit=51','/jobs?limit=2&limit=3','/jobs?ownerId=other','/jobs?cursor=','/jobs?cursor=a&cursor=b','/jobs?limit=1e2']){let called=false;const r=await request(path,{jobs:()=>{called=true;}});assert.equal(r.status,400);assert.equal(called,false);}
 for(const path of ['//jobs','/jobs/','/%6aobs','https://relay.example/jobs','/jobs#x'])assert.equal((await request(path)).handled,false);
 const r=await request('/jobs',{jobs:()=>{throw Error(SECRET);}});assert.equal(r.status,503);assert.deepEqual(JSON.parse(r.body),{error:'job_history_unavailable'});assert.doesNotMatch(r.body,new RegExp(SECRET));
});
test('history API drops unknown fields and fails closed on oversized/invalid projections',async()=>{
 const row={ref:hex('job'),state:'uncertain',createdAt:1000,updatedAt:2000,resultAvailable:false,reasonCode:'outcome_uncertain',body:SECRET,owner:SECRET};const r=await request('/jobs',{jobs:()=>({rows:[row],nextCursor:null,secret:SECRET})});assert.equal(r.status,200);assert.doesNotMatch(r.body,new RegExp(SECRET));
 for(const page of [{rows:Array(51).fill(row),nextCursor:null},{rows:[{...row,ref:SECRET}],nextCursor:null},{rows:[{...row,reasonCode:SECRET}],nextCursor:null},{rows:[],nextCursor:SECRET+'/'},null])assert.equal((await request('/jobs',{jobs:()=>page})).status,503);
});
// Source-safe routine-path contract fixture: existing signed registration/queue,
// not a new production selector, gate issuer or provider endpoint.
async function routineFixture(fn){const dir=mkdtempSync(join(tmpdir(),'picard-routine-')),path=join(dir,'db.sqlite');let now=Date.now(),calls=0,mode='complete',store=createRelayStore({dbPath:path,now:()=>now});
 const config={ownerId:'owner-a',allowedTaskId:'task-a',assistantId:'groq:openai/gpt-oss-20b',keyId:'fixture',secret:'SYNTHETIC_HMAC_ONLY_NOT_A_CREDENTIAL_123456'};
 const p={v:1,eventId:await digest(canonical(['owner-a','task-a','message'])),ownerId:'owner-a',taskId:'task-a',requestId:'message',grantId:'approved-fixture-grant',assistantId:config.assistantId,grantExpiresAt:now+60000,request:{text:'Sanitized synthetic approved request',createdAt:new Date(now).toISOString(),answerTo:null},context:{title:'Routine path fixture',nextAction:'',latestFinding:''}};p.payloadHash=await payloadHash(p);
 // File-local test double for the already-authorized provider boundary; no
 // production selector exports or activates this adapter.
 const adapter={kind:'approved-provider-test-double',ready:true,assistantId:config.assistantId,acceptsWorkScope:payload=>canonical(payload)===canonical(p),async answer(input){calls++;if(mode==='uncertain')throw Object.assign(Error('groq_outcome_uncertain'),{code:'groq_outcome_uncertain'});return {kind:'answer',outcomeKind:'information',body:'Synthetic durable result',statusChange:null,eventId:'resp:'+input.requestId,owner:input.owner,task:input.task,requestId:input.requestId,attempt:input.attempt};}};
 const request=async body=>{const s=await signRequest('https://fixture.invalid/bridge/v1',body,config),r=await createReceiver({store,config,assistantAdapter:adapter})(s.request);return {status:r.status,body:await verifyResponse(r,s.nonce,config)};};
 const dispatch=()=>createDispatcher({store,boardAdapter:{scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId},assistantAdapter:adapter,enabled:true,workerId:'fixture'}).runOnce();
 try{await fn({p,request,dispatch,get store(){return store;},calls:()=>calls,setMode:value=>{mode=value;},advance:ms=>{now+=ms;},reopen(){store.close();store=createRelayStore({dbPath:path,now:()=>now});}});}finally{store.close();rmSync(dir,{recursive:true,force:true});}
}
test('routine fixture repeated/concurrent submissions reuse one existing queue row and durable result',()=>routineFixture(async f=>{
 const body={v:1,action:'exchange',ownerId:f.p.ownerId,payload:f.p};const results=await Promise.all([f.request(body),f.request(body),f.request(body)]);assert.equal(results.every(r=>r.status===200&&r.body.state==='queued'),true);assert.equal(f.store.stats()[0].count,1);assert.equal((await f.dispatch()).status,'completed');assert.equal(f.calls(),1);f.reopen();assert.equal((await f.request(body)).body.state,'completed');assert.equal((await f.dispatch()).status,'idle');assert.equal(f.calls(),1);
 const result=await f.request({v:1,action:'result',ownerId:f.p.ownerId,taskId:f.p.taskId,eventId:f.p.eventId,payloadHash:f.p.payloadHash});assert.equal(result.body.result.body,'Synthetic durable result');
}));
test('routine fixture rejects changed owner/task/input/grant before creating work',()=>routineFixture(async f=>{
 for(const patch of [{ownerId:'other'},{taskId:'other'},{grantId:'other'},{request:{...f.p.request,text:'unapproved'}}]){const p={...f.p,...patch};p.payloadHash=await payloadHash(p);assert.equal((await f.request({v:1,action:'exchange',ownerId:f.p.ownerId,payload:p})).status,403);}assert.deepEqual(f.store.stats(),[]);assert.equal(f.calls(),0);
}));
test('routine fixture expiry blocks registration without a provider attempt',()=>routineFixture(async f=>{
 f.advance(60001);const r=await f.request({v:1,action:'exchange',ownerId:f.p.ownerId,payload:f.p});assert.equal(r.status,400);assert.equal(r.body.error,'scope_expired');assert.deepEqual(f.store.stats(),[]);assert.equal(f.calls(),0);
}));
test('routine fixture uncertainty is durable, reported consistently and never reclaimed or replayed',()=>routineFixture(async f=>{
 f.setMode('uncertain');const body={v:1,action:'exchange',ownerId:f.p.ownerId,payload:f.p};assert.equal((await f.request(body)).status,200);assert.equal((await f.dispatch()).status,'uncertain');assert.equal(f.calls(),1);f.reopen();assert.equal((await f.request(body)).body.state,'uncertain');for(let i=0;i<3;i++)assert.equal((await f.dispatch()).status,'idle');assert.equal(f.calls(),1);assert.equal(f.store.get(f.p.eventId).result_json,null);
}));
