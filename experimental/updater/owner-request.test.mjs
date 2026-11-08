import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runOwnerUpdateRequest,consumeOwnerUpdateRequest} from './owner-request.mjs';
import * as fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createUpdateRequestBridge} from '../runtime-control/src/runtime-control.mjs';
function fixture(patch={}){let value={v:1,state:'idle',requestedAt:null,finishedAt:null,retryAt:null},calls=0,hash='old';return {d:{now:()=>1000000,readStatus:async()=>value,writeStatus:async v=>{value=v;},blocked:async()=>false,release:async()=>hash,check:async()=>{calls++;hash='new';},...patch},get value(){return value;},get calls(){return calls;}};}
test('fixed request records installation, durable cooldown and no second check',async()=>{const f=fixture();assert.equal(await runOwnerUpdateRequest(f.d),'installed');assert.equal(f.calls,1);assert.equal(f.value.finishedAt,1000000);assert.equal(await runOwnerUpdateRequest(f.d),'cooldown');assert.equal(f.calls,1);});
test('unchanged release means up to date; failed check is never success',async()=>{const f=fixture({check:async()=>{}});assert.equal(await runOwnerUpdateRequest(f.d),'up_to_date');const bad=fixture({check:async()=>{throw Error('synthetic');}});assert.equal(await runOwnerUpdateRequest(bad.d),'failed');});
test('HOLD/STOP/policy/journal block before check; interrupted checks stay unknown',async()=>{const f=fixture({blocked:async()=>true});assert.equal(await runOwnerUpdateRequest(f.d),'held');assert.equal(f.calls,0);for(const state of ['checking','unknown']){const f=fixture({readStatus:async()=>({v:1,state,requestedAt:1,finishedAt:null,retryAt:2})});assert.equal(await runOwnerUpdateRequest(f.d),'unknown');assert.equal(f.calls,0);}});
test('preflight I/O and permission failures durably report failed without starting the updater',async()=>{
 for(const name of ['blocked','release']){
  const f=fixture({[name]:async()=>{throw Object.assign(Error('private path'),{code:'EACCES'});}});
  assert.equal(await runOwnerUpdateRequest(f.d),'failed');assert.equal(f.calls,0);
  assert.deepEqual(f.value,{v:1,state:'failed',requestedAt:1000000,finishedAt:1000000,retryAt:1300000});
 }
});
test('post-start observation failure and timed-out command stay unknown rather than claiming a known failure',async()=>{
 for(const name of ['blocked','release']){
  let reads=0;const f=fixture({[name]:async()=>{if(++reads>1)throw Error('private observation');return name==='blocked'?false:'old';}});
  assert.equal(await runOwnerUpdateRequest(f.d),'unknown');assert.equal(f.calls,1);assert.equal(f.value.state,'unknown');
 }
 const f=fixture({check:async()=>{throw Object.assign(Error('private child output'),{killed:true,signal:'SIGTERM'});}});
 assert.equal(await runOwnerUpdateRequest(f.d),'unknown');assert.equal(f.value.state,'unknown');
});
function queued(f){let removed=0;return {d:{...f.d,readRequest:async()=>({ino:1,dev:1,mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false}),removeRequest:async()=>{removed++;}},get removed(){return removed;}};}
test('queue is removed only after a known durable outcome and never after failed status I/O',async()=>{
 const f=fixture({blocked:async()=>{throw Error('PRIVATE');}}),q=queued(f);
 assert.equal(await consumeOwnerUpdateRequest(q.d),'failed');assert.equal(q.removed,1);assert.equal(f.calls,0);assert.doesNotMatch(JSON.stringify(f.value),/PRIVATE/);
 for(const failAt of ['read','intent','finish']){
  const f=fixture(),q=queued(f);let writes=0;
  if(failAt==='read')q.d.readStatus=async()=>{throw Error('read failed');};
  else q.d.writeStatus=async value=>{if(++writes===(failAt==='intent'?1:2))throw Error('write failed');await f.d.writeStatus(value);};
  await assert.rejects(consumeOwnerUpdateRequest(q.d),/failed/);assert.equal(q.removed,0);assert.equal(f.calls,failAt==='finish'?1:0);
 }
 const partial=fixture(),retained=queued(partial);retained.d.writeStatus=async value=>{await partial.d.writeStatus(value);if(value.state==='installed')throw Error('directory sync failed');};
 await assert.rejects(consumeOwnerUpdateRequest(retained.d),/sync failed/);assert.equal(retained.removed,0);assert.equal(partial.calls,1);assert.equal(partial.value.state,'installed');
});
test('unknown and interrupted requests preserve queue and original timestamps without replay',async()=>{
 for(const state of ['checking','unknown']){
  const original={v:1,state,requestedAt:1,finishedAt:null,retryAt:2};const f=fixture({readStatus:async()=>original}),q=queued(f);
  assert.equal(await consumeOwnerUpdateRequest(q.d),'unknown');assert.equal(q.removed,0);assert.equal(f.calls,0);
  assert.deepEqual(f.value,{...original,state:'unknown'});
 }
 const original={v:1,state:'held',requestedAt:1,finishedAt:2,retryAt:3},f=fixture({readStatus:async()=>original}),q=queued(f);
 assert.equal(await consumeOwnerUpdateRequest(q.d),'held');assert.equal(f.calls,0);assert.equal(q.removed,1);
});
test('changed or invalid queue identity is never removed',async()=>{
 const f=fixture(),q=queued(f);let reads=0;
 q.d.readRequest=async()=>({ino:++reads,dev:1,mode:0o40700,isDirectory:()=>true,isSymbolicLink:()=>false});
 await assert.rejects(consumeOwnerUpdateRequest(q.d),/request_changed/);assert.equal(q.removed,0);
 const bad=queued(f);bad.d.readRequest=async()=>({mode:0o40700,isDirectory:()=>false,isSymbolicLink:()=>true});
 await assert.rejects(consumeOwnerUpdateRequest(bad.d),/invalid_request/);assert.equal(bad.removed,0);
});
test('a helper that cannot start leaves durable queue evidence and the runtime reports unknown',{skip:process.platform!=='linux'},async()=>{
 const dir=await fs.mkdtemp(join(tmpdir(),'picard-startup-failure-')),root=join(dir,'queue'),statusRoot=join(dir,'status'),at=Date.now();
 try{
  await fs.mkdir(root,{mode:0o770});await fs.chmod(root,0o770);await fs.mkdir(statusRoot,{mode:0o755});await fs.chmod(statusRoot,0o755);
  const value={v:1,state:'idle',requestedAt:null,finishedAt:null,retryAt:null};await fs.writeFile(join(statusRoot,'request.json'),JSON.stringify(value),{mode:0o644});
  const b=createUpdateRequestBridge({enabled:true,root,statusRoot,administratorUid:process.getuid(),runtimeGid:process.getgid(),now:()=>at+20000});
  await fs.mkdir(join(root,'request'),{mode:0o700});await fs.utimes(join(root,'request'),new Date(at),new Date(at));const before=await fs.lstat(join(root,'request'));
  await assert.rejects(promisify(execFile)(process.execPath,['--picard-deliberate-invalid-startup-option'],{timeout:3000,maxBuffer:4096,windowsHide:true}));
  assert.deepEqual(JSON.parse(await fs.readFile(join(statusRoot,'request.json'),'utf8')),value);
  assert.equal((await fs.lstat(join(root,'request'))).ino,before.ino);assert.equal(b.status().state,'unknown');
  assert.throws(()=>b.request(),/update_unknown/);assert.equal((await fs.lstat(join(root,'request'))).ino,before.ino);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('fixed host units permit one start per five minutes without a restart or wider privileges',()=>{
 for(const file of ['picard-owner-update.path','picard-owner-update.service']){
  const text=readFileSync(new URL('./'+file,import.meta.url),'utf8');
  assert.match(text,/\[Unit\][\s\S]*StartLimitIntervalSec=300/);assert.match(text,/StartLimitBurst=1(?:\r?\n|$)/);assert.doesNotMatch(text,/^Restart=/m);
 }
 const service=readFileSync(new URL('./picard-owner-update.service',import.meta.url),'utf8');
 for(const line of ['NoNewPrivileges=true','ProtectSystem=strict','RestrictAddressFamilies=AF_UNIX','IPAddressDeny=any'])assert.ok(service.includes(line));
});
