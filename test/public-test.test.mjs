import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {workspaceFixture,fixtureToken,fixtureOrigin} from './fixtures/workspace-fixture.mjs';
import {createPublicTestHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {PUBLIC_TEST_INPUT_SHA} from '../experimental/runtime-control/src/admission-store.mjs';
import {createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';
import {createRuntimeAdmissionHandlers} from '../experimental/runtime-control/src/admission-runtime.mjs';

test('Linux production handler composition enables public status without weakening private authentication or bindings',{skip:process.platform!=='linux'},async()=>{
 const f=await workspaceFixture({realMarkers:false,publicTestEnabled:true});
 const store=createAdmissionStore({activationEnabled:true,dbPath:f.dbPath,relayStore:f.store.relay,now:f.now});
 try{
  const options={workspaceEnabled:true,publicTestEnabled:true,proxyConfigured:true,publicOrigin:'https://public.example',auth:{authenticate:async()=>false},store,binding:f.binding,origins:[fixtureOrigin],now:f.now,loadPolicy:()=>f.policy,currentAvailability:f.router.availability};
  const handler=createRuntimeAdmissionHandlers(options);
  for(const [url,status,origin] of [['/public-test/status',200,'https://public.example'],['/workspace/config',401,fixtureOrigin],['/request-catalogue',401,fixtureOrigin]]){
   const req=Readable.from([]);Object.assign(req,{method:'GET',url,headers:{host:'fixture.invalid',origin},socket:{remoteAddress:'127.0.0.1'}});
   const res={writeHead(s){this.status=s;},end(b){this.body=JSON.parse(b);}};
   assert.equal(await handler(req,res),true);assert.equal(res.status,status,url);
   if(status===200){assert.equal(res.body.enabled,false);assert.equal(res.body.remaining,0);}
  }
  assert.throws(()=>createRuntimeAdmissionHandlers({...options,binding:{...f.binding,unexpected:'not allowed'}}),/admission_configuration_invalid/);
  assert.equal(f.calls,0);assert.equal(f.store.relay.stats().length,0);
 }finally{store.close();f.close();}
});

async function fixture(options={}){
 const f=await workspaceFixture({realMarkers:false,publicTestEnabled:true,...options});
 let fresh=true;
 const handler=()=>createPublicTestHandler({enabled:true,proxyConfigured:true,auth:{authenticate:async(token,o)=>token===fixtureToken&&(!o?.fresh||fresh)},store:f.store,binding:f.binding,origins:[fixtureOrigin],publicOrigin:'https://public.example',now:f.now,loadPolicy:()=>f.policy,currentAvailability:f.router.availability});
 async function request(url,{owner=false,body,headers={},method=body===undefined?'GET':'POST',remote='127.0.0.1'}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
  Object.assign(req,{method,url,socket:{remoteAddress:remote},headers:{host:'fixture.invalid',origin:owner?fixtureOrigin:'https://public.example','content-type':'application/json','x-picard-public-client-ip':'192.0.2.1',...(owner?{cookie:'__Host-PicardSession='+fixtureToken}:{}),...headers}});
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.raw=body;try{this.body=JSON.parse(body);}catch{this.body=body;}}};
  assert.equal(await handler()(req,res),true);return res;
 }
 async function activate(){const p=await request('/public-test/owner/approval',{owner:true,body:{}});assert.equal(p.status,200);const result=await request('/public-test/owner/enable',{owner:true,body:{nonce:p.body.nonce,specSha256:p.body.specSha256,expectedRevision:p.body.revision,approve:true}});return {proof:p.body,result};}
 const submit=(requestId=randomUUID(),options={})=>request('/public-test/requests',{body:{requestId,inputSha256:PUBLIC_TEST_INPUT_SHA,approve:true},...options});
 return {f,request,activate,submit,setFresh:v=>{fresh=v;}};
}

test('default is disabled; fresh owner approval is exact, one-use, revision bound and public',async()=>{
 assert.equal(await createPublicTestHandler()({},{}),false);
 const x=await fixture();try{
  assert.equal((await x.submit()).status,503);
  assert.equal((await x.request('/public-test/owner')).status,401);
  x.setFresh(false);assert.equal((await x.activate().catch(()=>null)),null);x.setFresh(true);
  const a=await x.activate();assert.equal(a.result.status,200);assert.equal(a.result.body.state.totalGranted,8);
  assert.equal(x.f.calls,0);
  const old=a.proof;
  assert.equal((await x.request('/public-test/owner/enable',{owner:true,body:{nonce:old.nonce,specSha256:old.specSha256,expectedRevision:old.revision,approve:true}})).status,409);
  const refill=await x.activate();assert.equal(refill.result.status,409);assert.equal(x.f.store.publicTestState().totalGranted,8);
  const status=await x.request('/public-test/status');assert.equal(status.body.remaining,8);assert.equal(status.body.ready,true);assert.equal(status.headers['Access-Control-Allow-Origin'],'https://public.example');
  assert.ok(!JSON.stringify(status.body).includes(x.f.binding.ownerId));
 }finally{x.f.close();}
});

test('eight durable admissions, one at a time; duplicates and saved reads never spend another slot',async()=>{
 const x=await fixture();try{
  assert.equal((await x.activate()).result.status,200);let first;
  for(let i=0;i<8;i++){
   const id=randomUUID();first??=id;
   const r=await x.submit(id,{headers:{'x-picard-public-client-ip':'192.0.2.'+(i+1)}});assert.equal(r.status,201,JSON.stringify(r.body));
   assert.equal((await x.submit(randomUUID(),{headers:{'x-picard-public-client-ip':'198.51.100.20'}})).status,503);
   assert.equal(x.f.store.publicTestState().totalUsed,i+1);
   await x.f.dispatcher.runOnce();assert.equal(x.f.calls,i+1);
   const saved=await x.request('/public-test/results/'+id);assert.equal(saved.status,200);assert.equal(saved.body.state,'completed');assert.equal(saved.body.resultAvailable,true);
   const duplicate=await x.submit(id,{headers:{'x-picard-public-client-ip':'192.0.2.'+(i+1)}});assert.equal(duplicate.status,200);assert.equal(duplicate.body.sha256,saved.body.sha256);
   x.f.advance(61000);
  }
  x.f.restart();assert.equal(x.f.store.publicTestState().totalUsed,8);
  assert.equal((await x.submit()).status,503);assert.equal(x.f.calls,8);
  assert.equal((await x.request('/public-test/results/'+first)).body.resultAvailable,true);
  assert.equal((await x.activate()).result.status,200);assert.equal(x.f.store.publicTestState().totalGranted,16);
 }finally{x.f.close();}
});

test('input tampering, credentials, origin, forged proxy paths and private result IDs are rejected',async()=>{
 const x=await fixture();try{
  await x.activate();
  const bodies=[{requestId:randomUUID(),inputSha256:PUBLIC_TEST_INPUT_SHA,approve:true,prompt:'extra'},{requestId:randomUUID(),inputSha256:'0'.repeat(64),approve:true}];
  for(const body of bodies)assert.equal((await x.request('/public-test/requests',{body})).status,400);
  assert.equal((await x.submit(randomUUID(),{headers:{cookie:'__Host-PicardSession='+fixtureToken}})).status,401);
  assert.equal((await x.submit(randomUUID(),{headers:{origin:'https://other.example'}})).status,401);
  assert.equal((await x.submit(randomUUID(),{remote:'192.0.2.4'})).status,401);
  assert.equal((await x.submit(randomUUID(),{headers:{'x-picard-public-client-ip':'192.0.2.1, 198.51.100.1'}})).status,401);
  const d=await x.f.prepare();await x.f.submit(d,await x.f.approve(d));await x.f.dispatcher.runOnce();
  assert.equal((await x.request('/public-test/results/'+d.payload.requestId)).status,404);
  assert.equal(x.f.store.publicTestState().totalUsed,0);
 }finally{x.f.close();}
});

test('disable stops queued dispatch; resume preserves allowance; expiry and key replacement stop new work',async()=>{
 const x=await fixture();try{
  await x.activate();const id=randomUUID();assert.equal((await x.submit(id)).status,201);
  assert.equal((await x.request('/public-test/owner/disable',{owner:true,body:{}})).status,200);
  await x.f.dispatcher.runOnce();assert.equal(x.f.calls,0);
  assert.equal((await x.request('/public-test/owner/resume',{owner:true,body:{}})).status,200);
  await x.f.dispatcher.runOnce();assert.equal(x.f.calls,1);
  x.f.advance(172800001);assert.equal((await x.request('/public-test/status')).body.ready,false);assert.equal((await x.submit()).status,503);
  await x.f.rotateEnrollment({provePredecessor:true});assert.equal((await x.request('/public-test/status')).body.ready,false);
  assert.equal((await x.request('/public-test/results/'+id)).body.resultAvailable,true);
 }finally{x.f.close();}
});

test('uncertain dispatch consumes its slot, survives restart and cannot be refilled or replayed',async()=>{
 const x=await fixture();try{
  await x.activate();x.f.setMode('uncertain');const id=randomUUID();assert.equal((await x.submit(id)).status,201);await x.f.dispatcher.runOnce();
  x.f.restart();x.f.advance(61000);await x.f.dispatcher.runOnce();assert.equal(x.f.calls,1);assert.equal(x.f.store.publicTestState().totalUsed,1);
  assert.equal((await x.submit()).status,503);assert.equal((await x.activate()).result.status,409);
  assert.equal((await x.request('/public-test/results/'+id)).body.state,'uncertain');
 }finally{x.f.close();}
});

test('client cooldown and global attempt throttle are server enforced and persistent',async()=>{
 const x=await fixture();try{
  await x.activate();assert.equal((await x.submit()).status,201);await x.f.dispatcher.runOnce();x.f.advance(16000);
  assert.equal((await x.submit()).status,429);x.f.restart();assert.equal((await x.submit()).status,429);
  for(let i=0;i<10;i++)await x.request('/public-test/requests',{body:{}});
  assert.equal((await x.submit()).status,429);assert.equal(x.f.store.publicTestState().totalUsed,1);
 }finally{x.f.close();}
});

test('racing requests admit exactly one; a manual refill retires expired unused slots without pretending they ran',async()=>{
 const x=await fixture();try{
  await x.activate();const replies=await Promise.all([x.submit(),x.submit(randomUUID(),{headers:{'x-picard-public-client-ip':'198.51.100.3'}})]);
  assert.deepEqual(replies.map(r=>r.status).sort(),[201,503]);assert.equal(x.f.store.publicTestState().totalUsed,1);
  await x.f.dispatcher.runOnce();x.f.advance(172800001);
  assert.equal((await x.request('/public-test/owner',{owner:true})).body.canRefill,true);
  assert.equal((await x.activate()).result.status,200);
  const s=x.f.store.publicTestState();assert.equal(s.totalUsed,1);assert.equal(s.totalRetired,7);assert.equal(s.totalGranted,16);
  assert.equal((await x.request('/public-test/status')).body.remaining,8);assert.equal(x.f.calls,1);
 }finally{x.f.close();}
});

test('Linux durable one-shot markers enforce the real 512-token adapter path without a real provider call',{skip:process.platform!=='linux'},async()=>{
 const x=await fixture({realMarkers:true});try{
  await x.activate();const id=randomUUID();assert.equal((await x.submit(id)).status,201);
  await x.f.dispatcher.runOnce();assert.equal(x.f.calls,1);x.f.restart();await x.f.dispatcher.runOnce();assert.equal(x.f.calls,1);
  assert.equal((await x.request('/public-test/results/'+id)).body.resultAvailable,true);
 }finally{x.f.close();}
});
