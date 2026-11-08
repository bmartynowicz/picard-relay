import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createServer,request as httpRequest} from 'node:http';
import {workspaceFixture,fixtureOrigin} from '../../../test/fixtures/workspace-fixture.mjs';
import {createBootstrapState,createOwnerAuth,createConsoleHandler,CONSOLE_HTML} from '../src/oracle-service.mjs';
import {admissionConsoleHtml} from '../src/admission-ui.mjs';
test('real owner login, HTTP approval, real markers, dispatcher and restart recovery',{skip:process.platform!=='linux'?'Linux owner-auth and marker semantics required.':false},async()=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-workspace-http-')),authDir=path.join(root,'auth'),stateDir=path.join(root,'state');fs.mkdirSync(authDir,{mode:0o700});fs.mkdirSync(stateDir,{mode:0o700});
 const code='A'.repeat(43),password='Synthetic local fixture password';
 fs.writeFileSync(path.join(authDir,'auth-state.json'),JSON.stringify(createBootstrapState({code,createdAt:Date.now(),expiresAt:Date.now()+600000})),{mode:0o600});
 const auth=createOwnerAuth({stateDir:authDir}),f=await workspaceFixture({realMarkers:true,auth,directory:stateDir});
 const consoleHandler=createConsoleHandler({enabled:true,auth,origins:[fixtureOrigin],html:admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true})});
 const server=createServer(async(req,res)=>{if(await f.handler(req,res)||await consoleHandler(req,res))return;res.writeHead(404);res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const send=(url,body,cookie)=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:url,method:body===undefined?'GET':'POST',headers:{host:'fixture.invalid',origin:fixtureOrigin,'content-type':'application/json',...(cookie?{cookie}:{})}},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(text)}));});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});
 try{
  assert.equal((await send('/workspace/config')).status,401);
  const setup=await send('/auth/setup',{setupCode:code,password});assert.equal(setup.status,200);const cookie=setup.headers['set-cookie'][0].split(';')[0];
  const d=(await send('/workspace/drafts',f.brief(),cookie)).body.draft;assert(d);assert.equal(f.calls,0);
  const proof=(await send('/workspace/approvals',{requestId:d.payload.requestId},cookie)).body;
  const post={requestId:d.payload.requestId,nonce:proof.nonce,draftSha256:d.draftSha256,approve:true};assert.equal((await send('/workspace/requests',post,cookie)).status,201);
  assert.equal((await f.dispatcher.runOnce()).status,'completed');assert.equal(f.calls,1);f.restart();
  const newAuth=createOwnerAuth({stateDir:authDir});assert.equal(await newAuth.authenticate(cookie.split('=')[1]),true);
  const saved=await send('/workspace/requests/'+d.payload.eventId,undefined,cookie);assert.equal(saved.status,200);assert.equal(saved.body.result.body,f.output);assert.equal((await f.dispatcher.runOnce()).status,'idle');assert.equal(f.calls,1);
  const grade={expectedRevision:0,score:4,note:'Real local HTTP fixture.',resultSha256:saved.body.result.sha256};
  assert.equal((await send('/workspace/grades/'+d.payload.eventId,grade)).status,401);
  assert.equal((await send('/workspace/grades/'+d.payload.eventId,grade,cookie)).body.grade.latest.score,4);f.restart();
  const graded=await send('/workspace/requests/'+d.payload.eventId,undefined,cookie);assert.equal(graded.body.grade.revision,1);assert.equal(graded.body.review.revision,0);assert.equal(graded.body.result.body,f.output);assert.equal(f.calls,1);
  assert(fs.existsSync(path.join(stateDir,'groq-once-'+d.payload.grantId+'.consumed')));
  await send('/auth/logout',{},cookie);assert.equal((await send('/workspace/requests/'+d.payload.eventId,undefined,cookie)).status,401);
  console.log(JSON.stringify({proof:'workspace-real-http',node:process.version,realOwnerAuth:true,realInvocationMarkers:true,externalProviderCalls:0,syntheticProviderCalls:f.calls,rssBytes:process.memoryUsage().rss,heapUsedBytes:process.memoryUsage().heapUsed}));
 }finally{await new Promise(r=>server.close(r));f.close();fs.rmSync(root,{recursive:true,force:true});}
});
