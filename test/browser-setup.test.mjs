import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {request} from 'node:http';
import {createOwnerAuth} from '../experimental/runtime-control/src/oracle-service.mjs';
import {initialBrowserState,providerEnrollmentFiles,validateBrowserSetupConfig,digest,bootstrapUnits} from '../scripts/browser-setup-core.mjs';
import {createBrowserSetupHandler} from '../scripts/serve-browser-setup.mjs';
import {BROWSER_SETUP_HTML} from '../scripts/browser-setup-ui.mjs';
const claim=randomBytes(32).toString('base64url'),config={v:1,hostname:'picard.localhost',claimSha256:digest(claim)},initial=initialBrowserState(config),token=randomBytes(32).toString('base64url');
const input=()=>({v:1,requestId:randomUUID(),sessionToken:token,apiKey:'gsk_SYNTHETIC_BROWSER_QUALIFICATION_ONLY',accountLabel:'Synthetic Free project',organizationId:'org_test',projectId:'proj_test',freeConfirmed:true,keyProjectConfirmed:true});
test('one-hour hashed owner claim; initial enrollment retains existing owner/password/HMAC',()=>{
 assert.equal(initial.auth.bootstrap.codeHash,digest(claim));assert.equal(initial.auth.bootstrap.expiresAt-initial.auth.bootstrap.createdAt,3600000);
 const plan=providerEnrollmentFiles(input(),{hostname:config.hostname,identity:initial.identity});
 assert.equal(plan.ownerId,initial.identity.ownerId);assert.equal(plan.env.BRIDGE_KEY_ID,initial.identity.keyId);
 assert.ok(plan.privateFiles.some(f=>f.file.endsWith('/credentials/groq')));
 for(const file of plan.privateFiles)assert.ok(!file.file.endsWith('/credentials/hmac')&&!file.file.endsWith('/auth-state.json')&&!file.file.endsWith('/first-sign-in.txt'));
 for(const changed of [{freeConfirmed:false},{keyProjectConfirmed:false},{apiKey:'bad'},{requestId:'x'},{sessionToken:'x'},{ownerId:'injected'},{organizationId:'with\nnewline'}])assert.throws(()=>providerEnrollmentFiles({...input(),...changed},{hostname:config.hostname,identity:initial.identity}));
});
test('launch config rejects arbitrary origins and secrets; units have fixed one-use helper',()=>{
 assert.equal(validateBrowserSetupConfig({...config,hostname:'picard-141-148-50-78.sslip.io'}).v,1);
 for(const hostname of ['evil.example','http://example','picard-127-0-0-1.sslip.io','picard-172-16-0-1.sslip.io','picard-192-168-1-1.sslip.io','picard-999-0-0-1.sslip.io'])assert.throws(()=>validateBrowserSetupConfig({...config,hostname}));
 assert.throws(()=>validateBrowserSetupConfig({...config,apiKey:'secret'}));
 const units=bootstrapUnits();assert.match(units['picard-first-run-activate.path'],/PathExists=.*inbox\/request.json/);assert.match(units['picard-first-run-activate.service'],/Conflicts=picard-first-run.service/);assert.doesNotMatch(units['picard-first-run-activate.service'],/Restart=|\/bin\/sh|sudo/);
 assert.doesNotMatch(BROWSER_SETUP_HTML,/localStorage|sessionStorage\.setItem\([^,]*(?:key|password)/i);
 assert.match(BROWSER_SETUP_HTML,/history.replaceState\(null,'','\/'\)/);assert.match(BROWSER_SETUP_HTML,/prefers-reduced-motion/);assert.match(BROWSER_SETUP_HTML,/location.reload\(\)/);assert.doesNotMatch(BROWSER_SETUP_HTML,/location.replace\('\/#overview'\)/);
});
async function fixture(auth){
 let queued=null,status={state:'waiting'};
 const handler=createBrowserSetupHandler({auth,config,identity:initial.identity,readStatus:()=>status,enqueue:async row=>{queued=structuredClone(row);status={state:'connecting'};}});
 const server=createServer(async(req,res)=>{if(!await handler(req,res))res.writeHead(404).end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const call=(url,body,headers={})=>new Promise((resolve,reject)=>{const r=request({host:'127.0.0.1',port:server.address().port,path:url,method:body===undefined?'GET':'POST',headers:{Host:config.hostname,Origin:'https://'+config.hostname,'sec-fetch-site':'same-origin',Cookie:'__Host-PicardSession='+token,'Content-Type':'application/json',...headers}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{let value;try{value=JSON.parse(raw);}catch{value=raw;}resolve({status:res.statusCode,headers:res.headers,body:value});});});r.on('error',reject);r.end(body===undefined?undefined:typeof body==='string'?body:JSON.stringify(body));});
 return {call,queued:()=>queued,close:()=>new Promise(r=>server.close(r))};
}
test('protected same-origin submit, stale sign-in, body bounds and single queue acceptance',async()=>{
 let fresh=false;const f=await fixture({authenticate:async(t,options)=>t===token&&(!options?.fresh||fresh)});
 const body=input();delete body.sessionToken;
 try{
  assert.equal((await f.call('/setup/progress')).body.state,'waiting');
  assert.equal((await f.call('/setup/groq',body)).status,428);fresh=true;
  assert.equal((await f.call('/setup/groq',body,{Origin:'https://evil.example'})).status,403);
  assert.equal((await f.call('/setup/groq',body,{Cookie:''})).status,401);
  assert.equal((await f.call('/setup/groq',{...body,sessionToken:token})).status,400);
  assert.equal((await f.call('/setup/groq','x'.repeat(2049))).status,413);
  const accepted=await f.call('/setup/groq',body);assert.equal(accepted.status,202);assert.equal(accepted.body.requestId,body.requestId);
  assert.equal(f.queued().sessionToken,token);assert.equal(f.queued().apiKey,body.apiKey);
  assert.equal((await f.call('/setup/groq',body)).status,409);
  const progress=await f.call('/setup/progress');assert.deepEqual(progress.body,{state:'connecting'});assert.ok(!JSON.stringify(progress.body).includes(body.apiKey));
 }finally{await f.close();}
});
test('real Linux password claim is one-use, secret absent on disk, session remains valid', {skip:process.platform!=='linux'?'Linux ownership and /proc required':false},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'picard-browser-auth-'));fs.chmodSync(dir,0o700);fs.writeFileSync(dir+'/auth-state.json',JSON.stringify(initial.auth),{mode:0o600});
 try{
  const auth=createOwnerAuth({stateDir:dir}),password='Synthetic browser owner password';
  const session=await auth.setup({code:claim,password});assert.equal(await auth.authenticate(session.token,{fresh:true}),true);
  await assert.rejects(auth.setup({code:claim,password}));
  const state=fs.readFileSync(dir+'/auth-state.json','utf8');assert.ok(!state.includes(claim)&&!state.includes(password)&&!state.includes(session.token));
  const plan=providerEnrollmentFiles({...input(),sessionToken:session.token},{hostname:config.hostname,identity:initial.identity});assert.equal(plan.ownerId,initial.identity.ownerId);
  assert.equal(await auth.authenticate(session.token),true);assert.equal(fs.readFileSync(dir+'/auth-state.json','utf8'),state);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
