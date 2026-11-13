// Disposable-CI synthetic request through the physically installed runtime.
// The real service is stopped first; only this child has the fake transport.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {request} from 'node:http';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(process.getuid()>0);
const root='/usr/local/lib/board-event-relay',data='/var/lib/board-event-relay';
const {cookie,env}=JSON.parse(fs.readFileSync(0,'utf8'));assert.match(cookie,/^__Host-PicardSession=[A-Za-z0-9_-]+$/);
const target=fs.readlinkSync(root+'/current');assert.match(target,/^releases\/[a-f0-9]{64}$/);env.BRIDGE_RELEASE_HASH=target.slice(9);env.BRIDGE_CONTROL_SOCKET=data+'/control.sock';
const runtime=await import(pathToFileURL(root+'/'+target+'/src/oracle-service.mjs')),admission=await import(pathToFileURL(root+'/'+target+'/src/admission-runtime.mjs'));
const config=runtime.loadOracleConfig(env);config.port=0;let calls=0;
const feature=admission.prepareAdmissionRuntime({activationEnabled:true,config,env,fetchImpl:async()=>{calls++;assert.equal(calls,1);return new Response(JSON.stringify({id:'synthetic-installed-only',model:'openai/gpt-oss-20b',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Synthetic installed-runtime answer retained across update and key replacement.'}}],usage:{prompt_tokens:20,completion_tokens:12,total_tokens:32}}));}});
const service=await runtime.startOracleService(config,feature.adapter,{intervalMs:20,installSignals:false,admissionFactory:feature.attach});
async function call(url,body){return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:service.address().port,path:url,method:body?'POST':'GET',headers:{host:'picard.localhost',origin:'https://picard.localhost','sec-fetch-site':'same-origin','content-type':'application/json',cookie}},res=>{let raw='';res.setEncoding('utf8');res.on('data',v=>{raw+=v;assert.ok(raw.length<262144);});res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(raw)}));});req.setTimeout(5000,()=>req.destroy(Error('fixture_timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});}
try{
 const requestId=randomUUID(),draft=await call('/workspace/drafts',{requestId,taskId:'',title:'Installed-runtime synthetic retention check',requestText:'Give three short acceptance checks.',context:'Disposable CI only; fake transport; no external model call.',purpose:'sanitized-source-proposal'});assert.equal(draft.status,201);
 const proof=await call('/workspace/approvals',{requestId});assert.equal(proof.status,200);
 const sent=await call('/workspace/requests',{requestId,nonce:proof.body.nonce,draftSha256:draft.body.draft.draftSha256,approve:true});assert.equal(sent.status,201);
 let saved;
 for(let i=0;i<100;i++){saved=await call('/workspace/requests/'+sent.body.ref);if(saved.body.resultAvailable)break;await new Promise(resolve=>setTimeout(resolve,30));}
 assert.equal(saved.body.resultAvailable,true);assert.equal(calls,1);
 console.log(JSON.stringify({fixtureRef:sent.body.ref,enrollmentId:JSON.parse(fs.readFileSync(env.GROQ_FREE_GATE_FILE)).enrollmentId,syntheticResponses:calls,externalModelCalls:0}));
}finally{await service.shutdown();}
