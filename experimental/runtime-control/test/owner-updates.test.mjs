import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createUpdateRequestBridge} from '../src/runtime-control.mjs';
import {createConsoleHandler} from '../src/oracle-service.mjs';
const token='A'.repeat(43),origin='https://fixture.invalid';
test('owner update endpoint requires exact same-origin authenticated empty POST and never starts a command',async()=>{
 let calls=0;const handler=createConsoleHandler({enabled:true,auth:{authenticate:async t=>t===token},origins:[origin],updates:{status:()=>({v:1,enabled:true,state:'idle'}),request:()=>{calls++;return {v:1,state:'checking'};}}});
 async function send(method='POST',body='{}',headers={}){const req=Readable.from([Buffer.from(body)]);Object.assign(req,{url:'/updates',method,headers:{host:'fixture.invalid',origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'__Host-PicardSession='+token,...headers}});const res={writeHead(s,h){this.status=s;this.headers=h;},end(b){this.body=JSON.parse(b);}};await handler(req,res);return res;}
 for(const [headers,status] of [[{origin:'https://evil.invalid'},403],[{origin:undefined},403],[{'sec-fetch-site':'cross-site'},403],[{cookie:''},401],[{cookie:'__Host-PicardSession='+token+'; __Host-PicardSession='+token},401]])assert.equal((await send('POST','{}',headers)).status,status);
 for(const body of ['null','[]','{"unit":"evil.service"}','{"url":"https://evil.invalid"}','x'.repeat(65)])assert([400,413].includes((await send('POST',body)).status));
 assert.equal(calls,0);assert.equal((await send()).status,202);assert.equal(calls,1);assert.equal((await send('GET')).headers['Cache-Control'],'no-store, private');assert.equal(calls,1);
});
test('request queue is default disabled, single-flight, cooldown checked and rejects a symlink',{skip:process.platform!=='linux'},()=>{
 const dir=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-owner-update-')),root=path.join(dir,'queue'),statusRoot=path.join(dir,'status');fs.mkdirSync(root,{mode:0o770});fs.chmodSync(root,0o770);fs.mkdirSync(statusRoot,{mode:0o755});
 const at=Date.now(),options={root,statusRoot,administratorUid:process.getuid(),runtimeGid:process.getgid(),now:()=>at};
 const status=state=>fs.writeFileSync(path.join(statusRoot,'request.json'),JSON.stringify({v:1,state,requestedAt:1,finishedAt:2,retryAt:3}),{mode:0o644});
 try{status('idle');assert.equal(createUpdateRequestBridge(options).status().enabled,false);const b=createUpdateRequestBridge({...options,enabled:true});assert.equal(b.request().state,'checking');assert.throws(()=>b.request(),/update_checking/);fs.rmdirSync(path.join(root,'request'));
  status('held');assert.throws(()=>b.request(),/update_held/);status('checking');assert.equal(b.status().state,'unknown');assert.throws(()=>b.request(),/update_unknown/);status('idle');fs.writeFileSync(path.join(statusRoot,'request.json'),JSON.stringify({v:1,state:'idle',requestedAt:at-100000,finishedAt:at-99900,retryAt:at+200000}));assert.throws(()=>b.request(),/update_cooldown/);
  fs.unlinkSync(path.join(statusRoot,'request.json'));fs.symlinkSync('/etc/passwd',path.join(statusRoot,'request.json'));assert.equal(b.status().enabled,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
