import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {connectWorkspace} from '../tools/workspace-request.mjs';
import {createOwnerSessionCache,validCachedSession} from '../tools/owner-session-cache.mjs';
const origin='https://picard.example',cookie='__Host-PicardSession='+'A'.repeat(43);
function memory(value){return {value,writes:[],clears:0,async read(){return this.value;},async write(v){this.writes.push(v);this.value=v;return true;},async clear(){this.clears++;this.value=null;}};}
const valid=()=>({v:1,origin,cookie,expiresAt:Date.now()+60000});
test('valid session is checked with GET and reused without prompting or another login',async()=>{
 const cache=memory(valid());let prompts=0;const calls=[];
 const request=await connectWorkspace(origin,{cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;throw Error('no prompt');},
  fetchImpl:async(url,options)=>{calls.push([new URL(url).pathname,options.method]);assert.equal(options.headers.Cookie,cookie);return Response.json({ready:true});}});
 await request('/workspace/config');assert.equal(prompts,0);assert.equal(cache.writes.length,0);
 assert.deepEqual(calls,[['/workspace/config','GET'],['/workspace/config','GET']]);
});

test('explicit fresh sign-in skips the saved session and performs exactly one password check',async()=>{
 const saved=valid(),cache=memory(saved);let prompts=0,reads=0;const calls=[];
 cache.read=async()=>{reads++;return cache.value;};
 const replacement='__Host-PicardSession='+'B'.repeat(43);
 const request=await connectWorkspace(origin,{fresh:true,cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;return 'synthetic fresh password';},fetchImpl:async(url,options)=>{
  calls.push([new URL(url).pathname,options.method]);
  if(new URL(url).pathname==='/auth/login'){
   assert.equal(options.headers.Cookie,undefined);assert.equal(JSON.parse(options.body).password,'synthetic fresh password');
   return Response.json({ok:true},{headers:{'Set-Cookie':replacement+'; Secure; HttpOnly; Max-Age=28800; Path=/'}});
  }
  assert.equal(options.headers.Cookie,replacement);return Response.json({ready:true});
 }});
 assert.equal(reads,0);assert.equal(prompts,1);assert.equal(cache.clears,0);assert.equal(cache.writes.length,1);
 assert.equal(cache.value.cookie,replacement);assert(!JSON.stringify(cache.value).includes('synthetic fresh password'));
 assert.deepEqual(calls,[['/auth/login','POST']]);await request('/workspace/config');
 assert.deepEqual(calls,[['/auth/login','POST'],['/workspace/config','GET']]);
});

test('cancelled, rejected or interrupted fresh sign-in preserves the existing cache and never retries',async()=>{
 for(const mode of ['cancelled','rejected','offline']){
  const saved=valid(),cache=memory(saved);let requests=0,prompts=0;
  await assert.rejects(connectWorkspace(origin,{fresh:true,cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;if(mode==='cancelled')throw Error('cancelled');return 'dummy';},fetchImpl:async(url,options)=>{
   requests++;assert.equal(new URL(url).pathname,'/auth/login');assert.equal(options.headers.Cookie,undefined);
   if(mode==='offline')throw Error('offline');return Response.json({error:'auth_failed'},{status:401});
  }}),mode==='cancelled'?/cancelled/:mode==='offline'?{code:'response_unconfirmed'}:{code:'auth_failed'});
  assert.equal(prompts,1);assert.equal(requests,mode==='cancelled'?0:1);assert.equal(cache.value,saved);assert.equal(cache.writes.length,0);assert.equal(cache.clears,0);
 }
});

test('fresh sign-in validates its origin and flag before requesting a password',async()=>{
 let prompts=0;const passwordPrompt=async()=>{prompts++;return 'dummy';};
 await assert.rejects(connectWorkspace('http://picard.example',{fresh:true,passwordPrompt}),{code:'invalid_origin'});
 await assert.rejects(connectWorkspace(origin,{fresh:'true',passwordPrompt}),{code:'usage'});
 assert.equal(prompts,0);
});
test('revoked session prompts once and remembers only a bounded session, never the password',async()=>{
 const cache=memory(valid());let prompts=0;const paths=[];
 await connectWorkspace(origin,{cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;return 'synthetic password';},fetchImpl:async(url,options)=>{
  const path=new URL(url).pathname;paths.push(path);
  if(path==='/workspace/config')return Response.json({error:'unauthorized'},{status:401});
  assert.equal(options.headers.Cookie,undefined);assert.equal(JSON.parse(options.body).password,'synthetic password');
  return Response.json({ok:true},{headers:{'Set-Cookie':cookie+'; Secure; HttpOnly; Max-Age=28800; Path=/'}});
 }});
 assert.equal(prompts,1);assert.equal(cache.clears,1);assert.equal(cache.writes.length,1);
 assert(validCachedSession(cache.value,origin));assert(!JSON.stringify(cache.value).includes('synthetic password'));
 assert.deepEqual(paths,['/workspace/config','/auth/login']);
});
test('expired or different-origin sessions never leave the machine as credentials',async()=>{
 for(const stale of [{...valid(),expiresAt:Date.now()-1},{...valid(),origin:'https://other.example'}]){
  const cache=memory(stale);let prompts=0;
  await connectWorkspace(origin,{cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;return 'dummy';},fetchImpl:async(url,options)=>{
   assert.equal(new URL(url).pathname,'/auth/login');assert.equal(options.headers.Cookie,undefined);
   return Response.json({ok:true},{headers:{'Set-Cookie':cookie+'; Secure; HttpOnly; Max-Age=120; Path=/'}});
  }});
  assert.equal(prompts,1);assert.equal(cache.clears,1);assert(cache.value.expiresAt<=Date.now()+120000);
 }
});
test('network failure does not discard a valid session or prompt for another password',async()=>{
 const cache=memory(valid());let prompts=0;
 await assert.rejects(connectWorkspace(origin,{cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;return 'dummy';},fetchImpl:async()=>{throw Error('offline');}}),{code:'response_unconfirmed'});
 assert.equal(prompts,0);assert.equal(cache.clears,0);
});
test('unsupported platforms never persist plaintext credentials',async()=>{
 const cache=createOwnerSessionCache({platform:'linux'});assert.equal(await cache.read(origin),null);assert.equal(await cache.write(valid()),false);
});
test('permission denial does not replace a session or ask for another password',async()=>{
 const cache=memory(valid());let prompts=0;
 await assert.rejects(connectWorkspace(origin,{cache,onNotice:()=>{},passwordPrompt:async()=>{prompts++;return 'dummy';},
  fetchImpl:async()=>Response.json({error:'forbidden'},{status:403})}),{code:'forbidden'});
 assert.equal(prompts,0);assert.equal(cache.clears,0);
});
test('Windows DPAPI encrypts, reads and clears an origin-bound synthetic session',{skip:process.platform!=='win32'},async t=>{
 const directory=await mkdtemp(join(tmpdir(),'picard-session-test-'));t.after(()=>rm(directory,{recursive:true,force:true}));
 const cache=createOwnerSessionCache({directory});await cache.write(valid());
 const [name]=await readdir(directory),bytes=await readFile(join(directory,name));
 assert(!bytes.includes(Buffer.from(cookie)));assert(!bytes.includes(Buffer.from(origin)));
 assert.equal((await cache.read(origin)).cookie,cookie);assert.equal(await cache.read('https://other.example'),null);
 await cache.clear(origin);assert.equal(await cache.read(origin),null);
});
