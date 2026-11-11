import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:https';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {workspaceFixture,fixtureToken} from './fixtures/workspace-fixture.mjs';
import {readWorkspaceHttps} from '../tools/workspace-readonly.mjs';

function stdio(t,origin,cert){
  const child=spawn(process.execPath,['--jitless','--max-old-space-size=64',fileURLToPath(new URL('./fixtures/workspace-mcp-child.mjs',import.meta.url)),origin],
    {windowsHide:true,env:{...process.env,NODE_EXTRA_CA_CERTS:cert},stdio:['pipe','pipe','pipe']});
  let buffer='',sequence=0,stderr='';const messages=[],pending=new Map();
  child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdout.setEncoding('utf8');
  child.stdout.on('data',chunk=>{
    buffer+=chunk;let index;
    while((index=buffer.indexOf('\n'))>=0){const m=JSON.parse(buffer.slice(0,index));buffer=buffer.slice(index+1);messages.push(m);pending.get(m.id)?.(m);pending.delete(m.id);}
  });
  const exit=new Promise(resolve=>child.once('close',resolve));
  t.after(async()=>{child.stdin.end();const timer=setTimeout(()=>child.kill(),2000);await exit;clearTimeout(timer);});
  function request(method,params={},split=false){
    const id=++sequence;const response=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{pending.delete(id);reject(Error('stdio_timeout'));},10000);
      pending.set(id,m=>{clearTimeout(timer);resolve(m);});
    });
    const data=Buffer.from(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
    if(split){const at=data.indexOf(Buffer.from('🖖'))+1;child.stdin.write(data.subarray(0,at));child.stdin.write(data.subarray(at));}else child.stdin.write(data);
    return response;
  }
  return {child,exit,messages,get stderr(){return stderr;},request,
    call:(name,args={})=>request('tools/call',{name,arguments:args}),
    async initialize(){const result=await request('initialize',{protocolVersion:'2099-01-01',capabilities:{},clientInfo:{name:'Fixture 🖖',version:'1'}},true);
      assert.equal(result.result.protocolVersion,'2025-06-18');child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return result;}};
}
async function setup(t){
  const fixture=await workspaceFixture({realMarkers:false});t.after(()=>fixture.close());
  const dir=mkdtempSync(join(tmpdir(),'picard-workspace-mcp-tls-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore',windowsHide:true});
  const calls=[];let behavior='normal',origin;
  const server=createServer({key:readFileSync(join(dir,'key.pem')),cert:readFileSync(join(dir,'cert.pem'))},async(req,res)=>{
    calls.push({method:req.method,path:req.url,cookie:req.headers.cookie,origin:req.headers.origin});
    assert.equal(req.method,'GET');assert.equal(req.headers.origin,origin);
    assert.equal(req.headers.cookie,'__Host-PicardSession='+fixtureToken);
    if(behavior==='redirect'){res.writeHead(302,{Location:'https://never-follow.invalid/steal'}).end();return;}
    if(behavior==='oversize'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({body:'x'.repeat(1048576)}));return;}
    if(behavior==='malformed'){res.writeHead(200,{'Content-Type':'application/json'}).end('not-json '+fixtureToken);return;}
    const response=await fixture.request(req.url,{method:req.method,headers:{cookie:req.headers.cookie}});
    res.writeHead(response.status,response.headers).end(JSON.stringify(response.body));
  });
  server.on('tlsClientError',()=>{});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  origin='https://127.0.0.1:'+server.address().port;
  return {fixture,calls,origin,cert:join(dir,'cert.pem'),setBehavior:value=>{behavior=value;}};
}

test('real stdio and verified HTTPS read owned workspace data without writes or provider invocation',async t=>{
  const {fixture,calls,origin,cert}=await setup(t);
  const draft=await fixture.prepare(),proof=await fixture.approve(draft);await fixture.submit(draft,proof);await fixture.dispatcher.runOnce();
  assert.equal(fixture.calls,1);const client=stdio(t,origin,cert);
  assert.equal((await client.request('tools/list')).error.code,-32002);assert.equal(calls.length,0);
  await client.initialize();const list=(await client.request('tools/list')).result.tools;
  assert.deepEqual(list.map(t=>t.name),['workspace_status','workspace_list','workspace_get']);
  assert.ok(list.every(t=>t.annotations.readOnlyHint&&!t.annotations.destructiveHint));
  for(const name of ['workspace_draft','workspace_submit','compute_run'])assert.equal((await client.call(name)).error.code,-32602);
  assert.equal(calls.length,0);
  const config=(await client.call('workspace_status')).result.structuredContent.data;assert.equal(config.readOnly,true);
  const history=(await client.call('workspace_list')).result.structuredContent.data;assert.equal(history.rows[0].ref,draft.payload.eventId);
  const saved=(await client.call('workspace_get',{ref:draft.payload.requestId})).result.structuredContent.data;
  assert.equal(saved.result.body,fixture.output);
  fixture.setAvailable(false);assert.equal((await client.call('workspace_get',{ref:saved.ref})).result.structuredContent.data.result.body,fixture.output);
  const before=calls.length;const invalid=await client.call('workspace_get',{ref:saved.ref,method:'POST'});
  assert.equal(invalid.result.isError,true);assert.equal(calls.length,before);
  fixture.rotateSession();const expired=await client.call('workspace_status');
  assert.equal(expired.result.content[0].text,'owner_sign_in_required');assert.equal(calls.length,before+1);
  assert.ok(calls.every(c=>c.method==='GET'));assert.equal(fixture.calls,1);
  assert.ok(!JSON.stringify(client.messages).includes(fixtureToken));assert.ok(!client.stderr.includes(fixtureToken));
});

test('HTTPS redirects, malformed/oversized responses and untrusted certificates fail safely',async t=>{
  const {origin,cert,calls,setBehavior}=await setup(t),client=stdio(t,origin,cert);await client.initialize();
  for(const [behavior,code]of [['redirect','workspace_redirect_rejected'],['malformed','invalid_workspace_response'],['oversize','workspace_response_too_large']]){
    setBehavior(behavior);const before=calls.length,result=await client.call('workspace_status');
    assert.equal(result.result.isError,true);assert.equal(result.result.content[0].text,code);assert.equal(calls.length,before+1);
    assert.ok(!JSON.stringify(result).includes(fixtureToken));
  }
  const before=calls.length;
  await assert.rejects(readWorkspaceHttps({origin,path:'/workspace/config',cookie:'__Host-PicardSession='+fixtureToken}),/workspace_read_failed/);
  assert.equal(calls.length,before);
});

test('stdio malformed, duplicate, incomplete and oversized input stays bounded',async t=>{
  const {origin,cert}=await setup(t),client=stdio(t,origin,cert);
  client.child.stdin.write('not-json\n');await client.initialize();
  assert.ok(client.messages.some(m=>m.error?.code===-32700));
  assert.equal((await client.request('initialize',{protocolVersion:'2025-06-18'})).error.code,-32600);
  assert.equal((await client.request('unknown')).error.code,-32601);
  client.child.stdin.end('x'.repeat(16385));assert.equal(await client.exit,0);
  assert.equal(client.messages.at(-1).error.message,'Message too large');
  const other=stdio(t,origin,cert);other.child.stdin.end('{"jsonrpc":');assert.equal(await other.exit,0);
  assert.equal(other.messages.at(-1).error.message,'Incomplete message');
});
