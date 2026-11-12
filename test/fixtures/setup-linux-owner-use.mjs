import assert from 'node:assert/strict';
import fs from 'node:fs';
import {randomUUID} from 'node:crypto';
import {request} from 'node:http';
import {loadOracleConfig,startOracleService} from '../../experimental/runtime-control/src/oracle-service.mjs';
import {prepareAdmissionRuntime} from '../../experimental/runtime-control/src/admission-runtime.mjs';

assert.equal(process.getuid(),65534);
const {env,code}=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),config=loadOracleConfig(env);config.port=0;
let service,calls=0;
const open=async()=>{const feature=prepareAdmissionRuntime({activationEnabled:true,config,env,fetchImpl:async()=>{
 calls++;assert.equal(calls,1,'No automatic retry permitted');
 return new Response(JSON.stringify({id:'synthetic-setup-only',model:'openai/gpt-oss-20b',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Three synthetic acceptance checks.'}}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));
}});service=await startOracleService(config,feature.adapter,{intervalMs:20,installSignals:false,admissionFactory:feature.attach});};
let cookie='';
async function call(url,body){return new Promise((resolve,reject)=>{
 const req=request({host:'127.0.0.1',port:service.address().port,path:url,method:body?'POST':'GET',headers:{host:'picard.example.com',origin:'https://picard.example.com','sec-fetch-site':'same-origin','content-type':'application/json',cookie}},res=>{
  let raw='';res.setEncoding('utf8');res.on('data',v=>{raw+=v;assert.ok(raw.length<262144);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)}));
 });req.setTimeout(5000,()=>req.destroy(Error('timeout')));req.once('error',reject);req.end(body?JSON.stringify(body):undefined);
});}
await open();
try{
 assert.equal(calls,0);assert.equal((await call('/workspace/config')).status,401);
 const owner=await call('/auth/setup',{setupCode:code,password:'Synthetic setup qualification password 8!'});assert.equal(owner.status,200);
 cookie=owner.headers['set-cookie'][0].split(';')[0];
 const status=await call('/workspace/config');assert.equal(status.status,200);assert.equal(status.body.ready,true);assert.equal(calls,0);
 const draft=await call('/workspace/drafts',{requestId:randomUUID(),taskId:'',title:'First useful request',requestText:'Give three short acceptance checks.',context:'Synthetic setup fixture, no private data.',purpose:'sanitized-source-proposal'});
 assert.equal(draft.status,201);const d=draft.body.draft;
 assert.equal((await call('/workspace/requests',{requestId:d.payload.requestId,nonce:'invalid',draftSha256:d.draftSha256,approve:true})).status,409);assert.equal(calls,0);
 const proof=await call('/workspace/approvals',{requestId:d.payload.requestId});assert.equal(proof.status,200);
 const submitted=await call('/workspace/requests',{requestId:d.payload.requestId,nonce:proof.body.nonce,draftSha256:d.draftSha256,approve:true});assert.equal(submitted.status,201);
 let result;
 for(let i=0;i<100;i++){result=await call('/workspace/requests/'+submitted.body.ref);if(result.body.resultAvailable)break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(result.body.resultAvailable,true);assert.match(result.body.result.body,/Three synthetic acceptance checks/);assert.equal(calls,1);
 await service.shutdown();await open();
 const saved=await call('/workspace/requests/'+submitted.body.ref);assert.equal(saved.body.resultAvailable,true);assert.equal(saved.body.result.body,result.body.result.body);assert.equal(calls,1);
 console.log('first_use_and_restart_passed');
}finally{await service.shutdown();}
