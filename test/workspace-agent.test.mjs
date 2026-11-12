import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm,chmod,symlink,realpath} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {workspaceFixture,fixtureOrigin} from './fixtures/workspace-fixture.mjs';
import {createWorkspaceAccessCache} from '../tools/workspace-access-cache.mjs';
import {createAgentWorkspace} from '../tools/workspace-agent.mjs';
import {manageWorkspaceAccess} from '../tools/workspace-access.mjs';

async function setup(t){
 const f=await workspaceFixture({realMarkers:false});t.after(()=>f.close());let value=null;const writes=[];
 const request=async(path,body)=>{const r=await f.request(path,{body});if(r.status>=400)throw Error(r.body.error);return r.body;};
 const cache={async write(v){value=v;},async read(){return value;},async clear(){value=null;}};
 const enrolled=await manageWorkspaceAccess({command:'enroll',origin:fixtureOrigin,label:'Tool',mode:'approved-work',request,cache});
 const transport=async({path,authorization,body})=>{writes.push(path);const r=await f.request(path,{body,headers:{cookie:undefined,authorization}});return {status:r.status,data:r.body};};
 const client=createAgentWorkspace({origin:fixtureOrigin,readAccess:()=>cache.read(),now:f.now,readTransport:transport,writeTransport:transport});
 return {f,request,cache,client,enrolled,writes};
}
test('owner enrollment stores the token without printing it; exact owner approval hands one task to the agent',async t=>{
 const {f,request,cache,client,enrolled}=await setup(t),access=await cache.read();
 assert.equal(enrolled.stored,true);assert.ok(!JSON.stringify(enrolled).includes(access.token));
 const d=await client.prepare(f.brief());assert.equal(d.approvalRequired,true);assert.equal(f.calls,0);
 await assert.rejects(client.submit({requestId:d.requestId,draftSha256:d.draftSha256,nonce:'A'.repeat(43)}),/approval_invalid/);
 const p=await manageWorkspaceAccess({command:'approve',origin:fixtureOrigin,clientId:access.clientId,requestId:d.requestId,draftSha256:d.draftSha256,approve:true,request});
 assert.equal((await client.submit({requestId:d.requestId,draftSha256:d.draftSha256,nonce:p.nonce})).state,'queued');
 f.rotateSession();f.restart();await f.dispatcher.runOnce();
 assert.equal((await client.get({ref:d.requestId})).result.body,f.output);assert.equal(f.calls,1);
 f.setAvailable(false);assert.equal((await client.get({ref:d.ref})).result.body,f.output);
 await assert.rejects(client.prepare({...f.brief(),origin:'https://other.invalid'}),/invalid_arguments/);
 await assert.rejects(client.submit({requestId:d.requestId,draftSha256:d.draftSha256,nonce:p.nonce,approve:true}),/invalid_arguments/);
});
test('lost submit response is recovered with GET only, and revocation stops an already running tool',async t=>{
 const {f,client,request,cache,writes}=await setup(t),d=await client.prepare(f.brief()),access=await cache.read();
 const p=await manageWorkspaceAccess({command:'approve',origin:fixtureOrigin,clientId:access.clientId,requestId:d.requestId,draftSha256:d.draftSha256,approve:true,request});
 f.loseResponse();const result=await client.submit({requestId:d.requestId,draftSha256:d.draftSha256,nonce:p.nonce});
 assert.equal(result.recovery,'read-only');assert.equal(writes.filter(p=>p==='/workspace/requests').length,1);
 f.loseResponse(false);await f.dispatcher.runOnce();assert.equal(f.calls,1);
 await manageWorkspaceAccess({command:'revoke',origin:fixtureOrigin,clientId:access.clientId,request,cache});
 await assert.rejects(client.get({ref:d.ref}),/tool_access_required/);
 assert.equal(f.calls,1);assert.equal(await cache.read(),null);
});
test('tool access cache is origin-bound and protected on the actual operating system',async t=>{
 const {cache}=await setup(t),v=await cache.read(),dir=await realpath(await mkdtemp(join(tmpdir(),'picard-tool-access-')));t.after(()=>rm(dir,{recursive:true,force:true}));
 const disk=createWorkspaceAccessCache({directory:dir});await disk.write(v);
 assert.deepEqual(await disk.read(v.origin),v);assert.equal(await disk.read('https://other.invalid'),null);
 const [name]=await readdir(dir),bytes=await readFile(join(dir,name));
 if(process.platform==='win32')assert.ok(!bytes.includes(Buffer.from(v.token)));
 else{await chmod(join(dir,name),0o644);await assert.rejects(disk.read(v.origin),/tool_access_storage_failed/);await chmod(join(dir,name),0o600);}
 const expired=createWorkspaceAccessCache({directory:dir,now:()=>v.expiresAt+1});await assert.rejects(expired.read(v.origin),/tool_access_storage_failed/);
 await disk.clear(v.origin);assert.equal(await disk.read(v.origin),null);
 if(process.platform!=='win32'){
  const alias=dir+'-link';await symlink(dir,alias);t.after(()=>rm(alias,{force:true}));
  await assert.rejects(createWorkspaceAccessCache({directory:alias}).write(v),/tool_access_storage_failed/);
 }
});

test('actual stdio + verified HTTPS complete approved handoff, survive process restart and never expose credentials',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'picard-agent-tls-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
 let f,behavior='normal';const calls=[];
 const server=createServer({key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},async(req,res)=>{
  calls.push([req.method,req.url]);assert.equal(req.headers.cookie,undefined);assert.equal(req.headers.origin,origin);
  if(behavior==='redirect'){res.writeHead(302,{Location:'https://never-follow.invalid'}).end();return;}
  if(behavior==='echo'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({v:1,token:access.token}));return;}
  const handled=await f.handler(req,res);if(!handled)res.writeHead(404).end();
 });
 server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const origin='https://127.0.0.1:'+server.address().port;
 f=await workspaceFixture({realMarkers:false,origin});t.after(()=>f.close());
 const c=(await f.request('/workspace/clients',{body:{label:'TLS tool',mode:'approved-work',lifetimeMs:3600000}})).body;
 const access={v:1,origin,token:c.token,clientId:c.client.id,mode:'approved-work',expiresAt:c.client.expiresAt};
 function start(){
  const child=spawn(process.execPath,['--jitless','--max-old-space-size=64',fileURLToPath(new URL('./fixtures/workspace-agent-child.mjs',import.meta.url))],{windowsHide:true,env:{...process.env,NODE_EXTRA_CA_CERTS:join(dir,'cert.pem')},stdio:['pipe','pipe','pipe','pipe']});
  child.stdio[3].end(JSON.stringify(access));let buffer='',id=0,stderr='';const pending=new Map(),messages=[];
  child.stderr.on('data',c=>{stderr+=c;});child.stdout.on('data',c=>{buffer+=c;let n;while((n=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);messages.push(m);pending.get(m.id)?.(m);}});
  const exit=new Promise(r=>child.once('close',r));t.after(async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);await exit;clearTimeout(timer);});
  function send(method,params){const next=++id;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('stdio_timeout')),10000);pending.set(next,m=>{clearTimeout(timer);pending.delete(next);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:next,method,params})+'\n');});}
  return {send,messages,get stderr(){return stderr;},async initialize(){await send('initialize',{protocolVersion:'2025-06-18'});child.stdin.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');},call:(name,args={})=>send('tools/call',{name,arguments:args}),async stop(){child.stdin.end();await exit;}};
 }
 const tool=start();await tool.initialize();const listed=(await tool.send('tools/list')).result.tools;
 assert.equal(listed.length,5);assert.ok(listed.slice(0,3).every(t=>t.annotations.readOnlyHint));
 assert.equal((await tool.call('workspace_approve')).error.code,-32602);
 const prepared=await tool.call('workspace_prepare',f.brief()),d=prepared.result.structuredContent.data;assert.equal(prepared.result.structuredContent.readOnly,false);assert.equal(f.calls,0);
 const p=(await f.request('/workspace/client-approvals',{body:{clientId:access.clientId,requestId:d.requestId,draftSha256:d.draftSha256}})).body;
 f.rotateSession();f.restart();f.loseResponse();
 const sent=(await tool.call('workspace_submit',{requestId:d.requestId,draftSha256:d.draftSha256,nonce:p.nonce})).result;
 assert.equal(sent.structuredContent.data.recovery,'read-only');assert.equal(calls.filter(([m,p])=>m==='POST'&&p==='/workspace/requests').length,1);
 await tool.stop();f.loseResponse(false);await f.dispatcher.runOnce();f.restart();
 const next=start();await next.initialize();assert.equal((await next.call('workspace_get',{ref:d.ref})).result.structuredContent.data.result.body,f.output);assert.equal(f.calls,1);
 behavior='redirect';assert.equal((await next.call('workspace_prepare',f.brief())).result.content[0].text,'workspace_redirect_rejected');
 behavior='echo';assert.equal((await next.call('workspace_prepare',f.brief())).result.content[0].text,'draft_unconfirmed');
 assert.ok(!JSON.stringify([...tool.messages,...next.messages]).includes(access.token));assert.ok(!(tool.stderr+next.stderr).includes(access.token));
});
