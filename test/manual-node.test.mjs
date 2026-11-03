import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createNativeRelayTransport,readPrivateFile,writePrivateNew,createPrivateJournal,loadOperatorProfile} from '../tools/manual-node.mjs';
import {main} from '../tools/manual-request.mjs';

const SENTINEL='SYNTHETIC_PRIVATE_DIAGNOSTIC_NEVER_RETURN';
function request(url='https://fixture.invalid/bridge/v1',body='{}',redirect='manual'){
 return new Request(url,{method:'POST',redirect,body,headers:{'x-bridge-key':'synthetic-key-id'}});
}
function nativeFixture({status=200,chunks=['{}'],failure=null,abortOnDestroy=false}={}){
 const calls=[];
 const transport=createNativeRelayTransport((url,options,callback)=>{
  calls.push({url,options});if(failure==='throw')throw Error(SENTINEL);
  const req=new EventEmitter();req.end=body=>{calls[0].body=body.toString();queueMicrotask(()=>{
   if(failure==='request'){req.emit('error',Error(SENTINEL));return;}
   const res=new EventEmitter();res.statusCode=status;res.headers={'x-bridge-response':'synthetic-signature','authorization':SENTINEL,'location':'https://untrusted.invalid/'+SENTINEL};res.destroy=()=>{if(abortOnDestroy)res.emit('aborted');};callback(res);
   if(failure==='response'){res.emit('error',Error(SENTINEL));return;}
   if(failure==='aborted'){res.emit('aborted');return;}
   for(const part of chunks)res.emit('data',Buffer.from(part));res.emit('end');
  });};return req;
 });return {calls,transport};
}
test('native HTTPS pins certificate validation, timeout, exact method and bounded response projection',async()=>{
 const f=nativeFixture({chunks:['{"ok":','true}']});const r=await f.transport(request());assert.equal(await r.text(),'{"ok":true}');assert.equal(r.headers.get('x-bridge-response'),'synthetic-signature');assert.equal(r.headers.has('authorization'),false);assert.equal(r.headers.has('location'),false);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.rejectUnauthorized,true);assert.equal(f.calls[0].options.method,'POST');assert.ok(f.calls[0].options.signal instanceof AbortSignal);
});
for(const failure of ['throw','request','response','aborted'])test('native '+failure+' failure is bounded and redacted without retry',async()=>{
 const f=nativeFixture({failure});await assert.rejects(()=>f.transport(request()),e=>e.code==='response_unconfirmed'&&!e.message.includes(SENTINEL));assert.equal(f.calls.length,1);
});
for(const url of ['http://fixture.invalid/bridge/v1','https://fixture.invalid/other','https://fixture.invalid/bridge/v1?q=secret','https://fixture.invalid/bridge/v1#secret'])test('native transport refuses unsupported target '+url,async()=>{
 const f=nativeFixture();await assert.rejects(()=>f.transport(request(url)),/transport_scope_invalid/);assert.equal(f.calls.length,0);
});
test('native transport refuses automatic redirects before any request',async()=>{const f=nativeFixture();await assert.rejects(()=>f.transport(request(undefined,'{}','follow')),/transport_scope_invalid/);assert.equal(f.calls.length,0);});
test('native request and response byte limits are enforced',async()=>{
 const f=nativeFixture();await assert.rejects(()=>f.transport(request(undefined,'x'.repeat(24577))),/request_too_large/);assert.equal(f.calls.length,0);
 const large=nativeFixture({chunks:['x'.repeat(24576),'x']});await assert.rejects(()=>large.transport(request()),/response_too_large/);assert.equal(large.calls.length,1);
});
test('redirect response is returned once without following its target or leaking headers',async()=>{const f=nativeFixture({status:307});const r=await f.transport(request());assert.equal(r.status,307);assert.equal(r.headers.has('location'),false);assert.equal(f.calls.length,1);});
test('invalid status cannot surface uncontrolled native diagnostics',async()=>{const f=nativeFixture({status:9999});await assert.rejects(()=>f.transport(request()),/response_invalid/);assert.equal(f.calls.length,1);});
test('native HTTPS refuses an inherited TLS validation bypass',async()=>{const prior=process.env.NODE_TLS_REJECT_UNAUTHORIZED;try{process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const f=nativeFixture();await assert.rejects(()=>f.transport(request()),/transport_scope_invalid/);assert.equal(f.calls.length,0);}finally{if(prior===undefined)delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;else process.env.NODE_TLS_REJECT_UNAUTHORIZED=prior;}});
test('synchronous aborted event during oversize destroy cannot replace the size-limit code',async()=>{const f=nativeFixture({chunks:['x'.repeat(24577)],abortOnDestroy:true});await assert.rejects(()=>f.transport(request()),e=>e.code==='response_too_large');assert.equal(f.calls.length,1);});
test('native HTTPS combines the caller deadline and stops before I/O when already aborted',async()=>{const controller=new AbortController(),f=nativeFixture();controller.abort();await assert.rejects(()=>f.transport(new Request(request(),{signal:controller.signal})),/response_unconfirmed/);assert.equal(f.calls.length,0);});
for(const args of [[],['unknown'],['prepare','--unexpected','value'],['submit'],['result','--config'],['submit','--wait-ms','-1']])test('CLI rejects incomplete/unknown arguments without I/O '+JSON.stringify(args),async()=>{await assert.rejects(()=>main([...args]),/usage/);});

const posix={skip:process.platform!=='linux'?'Requires real Linux ownership, modes and fsync; qualify on Linux.':false};
function fixture(fn){return async()=>{const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-manual-test-'));fs.chmodSync(dir,0o700);try{await fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}};}
const put=(file,body)=>{fs.writeFileSync(file,body,{mode:0o600});fs.chmodSync(file,0o600);};
const intent={v:1,payload:{eventId:'a'.repeat(64),payloadHash:'b'.repeat(64)}};
test('private journal survives process/client reconstruction and reserves one immutable intent',posix,fixture(async dir=>{
 const journal=createPrivateJournal(path.join(dir,'journal'));assert.equal((await journal.reserve(intent)).created,true);const fresh=createPrivateJournal(path.join(dir,'journal'));assert.equal((await fresh.reserve(intent)).created,false);assert.deepEqual((await fresh.load(intent.payload.eventId)).intent,intent);assert.equal(fs.statSync(path.join(dir,'journal')).mode&0o777,0o700);
}));
test('exclusive writer never overwrites a previous private file',posix,fixture(async dir=>{const file=path.join(dir,'new.json');writePrivateNew(file,'old');assert.throws(()=>writePrivateNew(file,'new'),e=>e.code==='EEXIST');assert.equal(readPrivateFile(file),'old');assert.equal(fs.statSync(file).mode&0o777,0o600);}));
for(const mode of [0o644,0o640,0o400])test('private file refuses unexpected mode '+mode.toString(8),posix,fixture(async dir=>{const file=path.join(dir,'unsafe');put(file,'synthetic');fs.chmodSync(file,mode);assert.throws(()=>readPrivateFile(file),/private_file_invalid/);}));
test('private readers reject symlinks, hardlinks and noncanonical paths',posix,fixture(async dir=>{
 const file=path.join(dir,'original');put(file,'synthetic');const link=path.join(dir,'link');fs.symlinkSync(file,link);assert.throws(()=>readPrivateFile(link),/private_path_invalid/);fs.unlinkSync(link);fs.linkSync(file,link);assert.throws(()=>readPrivateFile(file),/private_file_invalid/);assert.throws(()=>readPrivateFile(dir+'/../'+path.basename(dir)+'/original'),/private_path_invalid/);
}));
test('private file reads reject invalid UTF8, oversized files and wrong owner',posix,fixture(async dir=>{const file=path.join(dir,'data');put(file,Buffer.from([0xff]));assert.throws(()=>readPrivateFile(file),/private_encoding_invalid/);put(file,'four');assert.throws(()=>readPrivateFile(file,{maxBytes:3}),/private_file_invalid/);assert.throws(()=>readPrivateFile(file,{owner:process.getuid()+1}),/private_file_invalid/);}));
test('corrupt or interrupted reservation remains non-reclaimable',posix,fixture(async dir=>{const root=path.join(dir,'journal'),j=createPrivateJournal(root);put(path.join(root,intent.payload.eventId+'.intent.json'),'{interrupted');await assert.rejects(()=>j.reserve(intent),/journal_invalid/);assert.equal(fs.readFileSync(path.join(root,intent.payload.eventId+'.intent.json'),'utf8'),'{interrupted');}));
test('unsafe journal directory is refused before reservation',posix,fixture(async dir=>{const root=path.join(dir,'journal');fs.mkdirSync(root,{mode:0o755});assert.throws(()=>createPrivateJournal(root),/private_directory_invalid/);}));
test('journal receipt bounds cannot erase or reclaim its durable intent',posix,fixture(async dir=>{const root=path.join(dir,'journal'),j=createPrivateJournal(root);await j.reserve(intent);await assert.rejects(()=>j.record(intent.payload.eventId,{body:'x'.repeat(16385)}),/receipt_too_large/);for(let n=0;n<64;n++)put(path.join(root,intent.payload.eventId+'.receipt-'+String(n).padStart(2,'0')+'.json'),'{}');await assert.rejects(()=>j.record(intent.payload.eventId,{state:'uncertain'}),/journal_receipt_capacity/);assert.equal((await j.reserve(intent)).created,false);}));
test('operator profile reads only existing permitted metadata, defers HMAC and never opens provider key',posix,fixture(async dir=>{
 const gate=path.join(dir,'gate.json'),secret=path.join(dir,'hmac'),config=path.join(dir,'runtime.env');put(gate,'{"v":3}');const fields={BRIDGE_ENABLED:'true',BRIDGE_PROVIDER:'groq',GROQ_ENABLED:'true',GROQ_ONE_SHOT:'true',BRIDGE_OWNER_ID:'fixture',BRIDGE_ALLOWED_TASK_ID:'fixture-task',BRIDGE_ASSISTANT_ID:'groq:openai/gpt-oss-20b',BRIDGE_KEY_ID:'fixture-key',BRIDGE_CONSOLE_ORIGINS:'["https://fixture.invalid"]',GROQ_FREE_GATE_FILE:gate,BRIDGE_HMAC_SECRET_FILE:secret,GROQ_API_KEY_FILE:'/does/not/exist/SYNTHETIC_PROVIDER_KEY'};put(config,Object.entries(fields).map(([k,v])=>k+'='+v).join('\n'));
 const p=loadOperatorProfile(config,'https://fixture.invalid');assert.equal(p.config.ownerId,'fixture');assert.throws(()=>p.readHmacSecret(),e=>e.code==='ENOENT');put(secret,'synthetic-hmac-only');assert.equal(p.readHmacSecret(),'synthetic-hmac-only');assert.throws(()=>loadOperatorProfile(config,'https://other.invalid'),/configuration_unavailable/);put(config,fs.readFileSync(config,'utf8')+'\nBRIDGE_OWNER_ID=duplicate');assert.throws(()=>loadOperatorProfile(config,'https://fixture.invalid'),/configuration_unavailable/);
}));
test('independent concurrent processes share exactly one durable reservation; restart does not reclaim',posix,fixture(async dir=>{
 const journal=path.join(dir,'journal');createPrivateJournal(journal);const input=path.join(dir,'intent.json');put(input,JSON.stringify(intent));const child=fileURLToPath(new URL('./fixtures/manual-journal-child.mjs',import.meta.url));
 const run=()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[child,journal,input],{env:process.env,stdio:['ignore','pipe','pipe']});let raw='',err='';p.stdout.on('data',d=>raw+=d);p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',code=>{if(code!==0)reject(Error('child_failed:'+err));else resolve(JSON.parse(raw));});});
 const results=await Promise.all([run(),run(),run()]);assert.equal(results.filter(r=>r.created).length,1);assert.equal((await run()).created,false);
}));
