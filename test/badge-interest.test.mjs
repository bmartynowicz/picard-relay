import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {workspaceFixture,fixtureOrigin} from './fixtures/workspace-fixture.mjs';
import {createBadgeInterestHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {createRuntimeAdmissionHandlers} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';

async function fixture(){
 const f=await workspaceFixture({realMarkers:false});
 const options=()=>({enabled:true,proxyConfigured:true,publicOrigin:'https://public.example',store:f.store,binding:f.binding,origins:[fixtureOrigin],now:f.now});
 let handler=createBadgeInterestHandler(options());
 async function request({url='/public/badge-interest',method,body,headers={},remote='127.0.0.1'}={}){
  const req=Readable.from(body===undefined?[]:[Buffer.from(typeof body==='string'?body:JSON.stringify(body))]);
  Object.assign(req,{url,method:method??(body===undefined?'GET':'POST'),socket:{remoteAddress:remote},headers:{host:'fixture.invalid',origin:'https://public.example','content-type':'application/json',...headers}});
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body?JSON.parse(body):null;}};
  return {handled:await handler(req,res),...res};
 }
 return {f,request,restart(){f.restart();handler=createBadgeInterestHandler(options());}};
}

test('anonymous badge interest persists once, reopens and never creates work or spends the public trial',async()=>{
 const x=await fixture();try{
  const before=x.f.store.publicTestState(),voteId=randomUUID();
  assert.equal((await x.request()).body.count,0);
  const first=await x.request({body:{voteId}});assert.equal(first.status,201);assert.equal(first.body.count,1);assert.equal(first.body.voted,true);
  const repeat=await x.request({body:{voteId}});assert.equal(repeat.status,200);assert.equal(repeat.body.count,1);
  x.restart();const recovered=await x.request({url:'/public/badge-interest/status',body:{voteId}});
  assert.deepEqual(recovered.body,{v:1,count:1,accepting:true,voted:true});
  assert.equal((await x.request({url:'/public/badge-interest/status',body:{voteId:randomUUID()}})).body.voted,false);
  assert.equal((await x.request()).body.count,1);
  assert.deepEqual(x.f.store.publicTestState(),before);assert.equal(x.f.calls,0);assert.equal(x.f.store.relay.stats().length,0);
  assert.ok(!JSON.stringify(recovered.body).includes(voteId));assert.ok(!JSON.stringify(recovered.body).includes(x.f.binding.ownerId));
 }finally{x.f.close();}
});

test('badge route rejects contact fields, credentials, forged hosts/origins, direct access and oversized bodies',async()=>{
 assert.equal(await createBadgeInterestHandler()({},{}),false);
 const x=await fixture();try{
  for(const options of [
   {body:{voteId:randomUUID(),email:'test@example.invalid'}},
   {body:{voteId:'not-a-uuid'}},{body:{voteId:null}},
   {body:'{"voteId":"'+'a'.repeat(200)+'"}'},
   {body:{voteId:randomUUID()},headers:{origin:'https://other.example'}},
   {body:{voteId:randomUUID()},headers:{host:'other.example'}},
   {body:{voteId:randomUUID()},headers:{cookie:'private=not-accepted'}},
   {body:{voteId:randomUUID()},headers:{authorization:'Bearer not-accepted'}},
   {body:{voteId:randomUUID()},remote:'192.0.2.1'}
  ]){const r=await x.request(options);assert.ok([400,401,413].includes(r.status),JSON.stringify(r));}
  assert.equal((await x.request()).body.count,0);assert.equal(x.f.calls,0);
  const cors=await x.request({method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'content-type'}});
  assert.equal(cors.status,204);assert.equal(cors.headers['Access-Control-Allow-Origin'],'https://public.example');assert.equal(cors.headers['Access-Control-Allow-Credentials'],undefined);
 }finally{x.f.close();}
});

test('new votes have a durable global rate bound; duplicate checks remain reads',async()=>{
 const x=await fixture();try{
  let first;for(let i=0;i<10;i++){const voteId=randomUUID();first??=voteId;assert.equal((await x.request({body:{voteId}})).status,201);}
  x.restart();assert.equal((await x.request({body:{voteId:randomUUID()}})).status,429);
  assert.equal((await x.request({body:{voteId:first}})).body.count,10);
  x.f.advance(61000);assert.equal((await x.request({body:{voteId:randomUUID()}})).status,201);
 }finally{x.f.close();}
});

test('count capacity is finite and existing vote receipts remain readable at capacity',async()=>{
 const x=await fixture();try{
  const first=randomUUID();for(let i=0;i<4096;i++)x.f.store.saveBadgeInterest(x.f.binding.ownerId,i?randomUUID():first);
  const full=await x.request();assert.equal(full.body.count,4096);assert.equal(full.body.accepting,false);
  assert.equal((await x.request({body:{voteId:first}})).status,200);
  assert.equal((await x.request({body:{voteId:randomUUID()}})).status,503);
  assert.equal((await x.request()).body.count,4096);assert.equal(x.f.calls,0);
 }finally{x.f.close();}
});

test('production composition keeps badge interest opt-in and private endpoints authenticated',{skip:process.platform!=='linux'},async()=>{
 const x=await fixture(),store=createAdmissionStore({activationEnabled:true,dbPath:x.f.dbPath,relayStore:x.f.store.relay,now:x.f.now});try{
  const options={workspaceEnabled:true,badgeInterestEnabled:true,proxyConfigured:true,publicOrigin:'https://public.example',auth:{authenticate:async()=>false},store,binding:x.f.binding,origins:[fixtureOrigin],now:x.f.now,loadPolicy:()=>x.f.policy,currentAvailability:x.f.router.availability};
  const on=createRuntimeAdmissionHandlers(options),off=createRuntimeAdmissionHandlers({...options,badgeInterestEnabled:false});
  async function call(h,url){const req=Readable.from([]);Object.assign(req,{url,method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'fixture.invalid',origin:url.startsWith('/workspace/')?fixtureOrigin:'https://public.example'}});const res={writeHead(s){this.status=s;},end(b){this.body=JSON.parse(b);}};return {handled:await h(req,res),...res};}
  assert.equal((await call(on,'/public/badge-interest')).status,200);
  assert.equal((await call(off,'/public/badge-interest')).handled,false);
  assert.equal((await call(on,'/workspace/config')).status,401);
  assert.equal(x.f.calls,0);
 }finally{store.close();x.f.close();}
});
