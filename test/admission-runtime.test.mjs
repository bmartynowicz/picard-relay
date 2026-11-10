import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {request as nativeHttpRequest} from 'node:http';
import {fixture,syntheticLegacyBaseline} from './fixtures/admission-fixture.mjs';
import {startOracleService,loadOracleConfig,createOwnerAuth,createBootstrapState,CONSOLE_MAX_BYTES} from '../experimental/runtime-control/src/oracle-service.mjs';
import {readExistingAdmissionFile,prepareAdmissionRuntime,admissionConfigurationDigest} from '../experimental/runtime-control/src/admission-runtime.mjs';
import {createCatalogueLoader} from '../experimental/runtime-control/src/admission-catalogue.mjs';
import {createAdmissionStore} from '../experimental/runtime-control/src/admission-store.mjs';
import {createAdmissionHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
import {admissionConsoleHtml} from '../experimental/runtime-control/src/admission-ui.mjs';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';
const linux={skip:process.platform!=='linux'?'Requires actual Linux modes, O_NOFOLLOW and loopback server lifecycle.':false};
const adapter={kind:'groq-durable-one-shot',assistantId:'groq:openai/gpt-oss-20b',canServeResults:true,ready:false,answer(){throw Error('NO_PROVIDER_ALLOWED');}};
const config=f=>({enabled:true,keyId:'fixture',secret:'SYNTHETIC_HMAC_ONLY_NEVER_A_REAL_SECRET_123',ownerId:f.catalogue.ownerId,assistantId:adapter.assistantId,allowedTaskId:f.catalogue.taskId,dbPath:f.dbPath,port:0,consoleEnabled:false,admissionEnabled:false,consoleOrigins:[]});
function loopbackRequest(url,{method='GET',headers={},body}={}){
 const target=new URL(url);assert.equal(target.protocol,'http:');assert.equal(target.hostname,'127.0.0.1');
 const limit=target.pathname==='/'?CONSOLE_MAX_BYTES:131072;
 return new Promise((resolve,reject)=>{const req=nativeHttpRequest(target,{method,headers},res=>{let size=0;const parts=[];res.on('data',chunk=>{size+=chunk.length;if(size>limit){reject(Error('fixture_response_too_large'));res.destroy();return;}parts.push(chunk);});res.on('error',reject);res.on('end',()=>{const bytes=Buffer.concat(parts);resolve({status:res.statusCode,text:async()=>bytes.toString('utf8'),json:async()=>JSON.parse(bytes.toString('utf8')),arrayBuffer:async()=>bytes});});});req.setTimeout(5000,()=>req.destroy(Error('fixture_http_timeout')));req.on('error',reject);req.end(body);});
}

test('disabled runtime preparation never reads even hostile environment properties',()=>{
 const env=new Proxy({},{get(){throw Error('MUST_NOT_READ_ENVIRONMENT');}});assert.equal(prepareAdmissionRuntime({activationEnabled:false,env}),null);
 assert.deepEqual(loadOracleConfig({}),{enabled:false});
});

test('configuration digest changes with owner, task, key, origins, marker path or enrollment',()=>{
 const input={config:{ownerId:'owner',allowedTaskId:'task',assistantId:adapter.assistantId,keyId:'key',consoleOrigins:['https://fixture.invalid']},enrollmentId:'a'.repeat(64),keySha256:'b'.repeat(64),markerDirectory:'/synthetic/markers'},original=admissionConfigurationDigest(input);
 for(const mutate of [v=>v.config.ownerId='other',v=>v.config.allowedTaskId='other',v=>v.config.keyId='other',v=>v.config.consoleOrigins.push('https://other.invalid'),v=>v.enrollmentId='c'.repeat(64),v=>v.keySha256='c'.repeat(64),v=>v.markerDirectory='/other',v=>v.config.admissionLegacyBaselineFile='/synthetic/baseline',v=>v.config.admissionLegacyBaselineSha256='d'.repeat(64)]){const copy=structuredClone(input);mutate(copy);assert.notEqual(admissionConfigurationDigest(copy),original);}
});

test('existing synthetic configuration file read is bounded and refuses unsafe metadata or aliases',linux,async t=>{
 const f=await fixture(t),file=path.join(f.dir,'synthetic-config');fs.writeFileSync(file,'SYNTHETIC_METADATA_ONLY',{mode:0o600});
 assert.equal(readExistingAdmissionFile(file).text,'SYNTHETIC_METADATA_ONLY');
 fs.chmodSync(file,0o640);assert.equal(readExistingAdmissionFile(file).text,'SYNTHETIC_METADATA_ONLY');
 fs.chmodSync(file,0o644);assert.throws(()=>readExistingAdmissionFile(file),/admission_configuration_invalid/);fs.chmodSync(file,0o600);
 const alias=path.join(f.dir,'alias');fs.symlinkSync(file,alias);assert.throws(()=>readExistingAdmissionFile(alias),/admission_configuration_invalid/);fs.unlinkSync(alias);
 fs.linkSync(file,alias);assert.throws(()=>readExistingAdmissionFile(file),/admission_configuration_invalid/);fs.unlinkSync(alias);
 fs.writeFileSync(file,Buffer.from([0xff]));assert.throws(()=>readExistingAdmissionFile(file),/admission_configuration_invalid/);
 fs.writeFileSync(file,'x'.repeat(16385));assert.throws(()=>readExistingAdmissionFile(file),/admission_configuration_invalid/);
});

test('runtime catalogue remains root-controlled and is not silently replaced by a writable fixture',linux,async t=>{
 const f=await fixture(t),dir=path.join(f.dir,'catalogue');fs.mkdirSync(dir,{mode:0o750});const file=path.join(dir,'catalogue.json');fs.writeFileSync(file,'{}\n',{mode:0o640});
 const wrong=createCatalogueLoader({activationEnabled:true,file,expectedUid:process.getuid()+1,expectedGid:process.getgid()});assert.throws(wrong,/catalogue_unavailable/);
 const dbAlias=path.join(f.dir,'database-link');fs.symlinkSync(f.dbPath,dbAlias);assert.throws(()=>createAdmissionStore({activationEnabled:true,dbPath:dbAlias,relayStore:f.store.relay}),/admission_storage_invalid/);
});

test('disabled live-service composition opens none of the new admission routes',linux,async t=>{
 const f=await fixture(t),service=await startOracleService(config(f),adapter,{intervalMs:60000,installSignals:false});
 try{for(const [method,url] of [['GET','/request-catalogue'],['POST','/request-approvals'],['POST','/requests'],['GET','/requests/'+'a'.repeat(64)]]){const response=await loopbackRequest('http://127.0.0.1:'+service.address().port+url,{method,...(method==='POST'?{body:'{}'}:{})});assert.equal(response.status,404,url);await response.arrayBuffer();}assert.equal(f.store.relay.stats().length,0);}finally{await service.shutdown();}
});

test('failed admission attachment closes setup and exposes neither listener nor private exception',linux,async t=>{
 const f=await fixture(t);await assert.rejects(startOracleService({...config(f),admissionEnabled:true},adapter,{installSignals:false,admissionFactory(){throw Error('PRIVATE_ATTACHMENT_SENTINEL');}}),e=>e.message==='admission_configuration_invalid');
 assert.equal(f.store.relay.stats().length,0);
});

test('actual loopback composition authenticates Requests and commits one fixed job without a provider call',linux,async t=>{
 const f=await fixture(t),stateDir=path.join(f.dir,'owner-auth');fs.mkdirSync(stateDir,{mode:0o700});const code=Buffer.alloc(32,7).toString('base64url');
 fs.writeFileSync(path.join(stateDir,'auth-state.json'),JSON.stringify(createBootstrapState({code,createdAt:f.now(),expiresAt:f.now()+900000})),{mode:0o600});
 const session=await createOwnerAuth({stateDir}).setup({code,password:'SYNTHETIC HTTP FIXTURE 8!'});
 const origins=['https://fixture.invalid'],c={...config(f),consoleEnabled:true,consoleAuthDir:stateDir,consoleOrigins:origins,admissionEnabled:true};
 const service=await startOracleService(c,adapter,{intervalMs:60000,installSignals:false,admissionFactory({store,auth,baseHtml}){
  const admissionStore=createAdmissionStore({activationEnabled:true,dbPath:f.dbPath,relayStore:store,now:f.now,legacyBinding:f.binding,loadLegacyBaseline:()=>syntheticLegacyBaseline(f),readLegacyMarkers:()=>[]});
  return {html:admissionConsoleHtml(baseHtml,{activationEnabled:true}),handler:createAdmissionHandler({activationEnabled:true,store:admissionStore,auth,loadPolicy:()=>f.policy,binding:f.binding,origins,now:f.now,currentAvailability:()=>({acceptingRequests:true,pendingUncertainty:false,costContradiction:false,code:'ready'})}),dispatchStore:{...store,claimNext:()=>null},close:()=>admissionStore.close()};
 }});
 try{
  const base='http://127.0.0.1:'+service.address().port,headers={host:'fixture.invalid',origin:origins[0],cookie:'__Host-PicardSession='+session.token,'sec-fetch-site':'same-origin','content-type':'application/json'};
  const anonymous=await loopbackRequest(base+'/request-catalogue',{headers:{...headers,cookie:''}});assert.equal(anonymous.status,401);await anonymous.arrayBuffer();
  const page=await loopbackRequest(base+'/',{headers});assert.equal(page.status,200);assert.match(await page.text(),/id="nav-requests"/);
  const challenge=await loopbackRequest(base+'/request-approvals',{method:'POST',headers,body:canonical(f.selection)});assert.equal(challenge.status,200);const proof=await challenge.json();
  const body=canonical({...f.selection,nonce:proof.nonce,approvedInputSha256:f.entry.inputSha256,approve:true});
  const registered=await loopbackRequest(base+'/requests',{method:'POST',headers,body});assert.equal(registered.status,201);const receipt=await registered.json();assert.equal(receipt.ref,f.entry.slots[0].eventId);
  const duplicate=await loopbackRequest(base+'/requests',{method:'POST',headers,body});assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.deepEqual(f.store.relay.stats().map(r=>({...r})),[{state:'queued',count:1}]);
 }finally{await service.shutdown();}
});
