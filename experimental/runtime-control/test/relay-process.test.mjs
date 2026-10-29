import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createRelayStore} from '../src/relay-store.mjs';
import {createDispatcher} from '../src/dispatcher.mjs';
import {canonical,payloadHash,digest} from '../src/protocol.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),child=fileURLToPath(new URL('./relay-crash-child.mjs',import.meta.url));
function cleanup(dir){const resolved=path.resolve(dir);if(path.dirname(resolved)!==path.resolve(tmpdir())||!path.basename(resolved).startsWith('oracle-bridge-'))throw Error('Unsafe test cleanup target');rmSync(resolved,{recursive:true,force:true});}
function run(file,args=[],env={}){return new Promise((resolve,reject)=>{const p=spawn(process.execPath,[file,...args],{env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',s=>stdout+=s);p.stderr.on('data',s=>stderr+=s);p.once('error',reject);p.once('exit',code=>resolve({code,stdout,stderr}));});}
let passed=0;
for(const mode of ['result','invoking','claim']){
 const dir=mkdtempSync(path.join(tmpdir(),'oracle-bridge-restart-')),dbPath=path.join(dir,'ledger.db'),now=Date.now(),file=path.join(dir,'payload.json');
 const p={v:1,eventId:await digest(canonical(['owner','task','message'])),ownerId:'owner',taskId:'task',requestId:'message',grantId:'grant',assistantId:'axiom-test',grantExpiresAt:now+3600000,request:{text:'Isolated process fixture',createdAt:new Date(now).toISOString(),answerTo:null},context:{title:'Fixture',nextAction:'',latestFinding:''}};p.payloadHash=await payloadHash(p);writeFileSync(file,canonical(p));
 try{
  assert.equal((await run(child,['seed',dbPath,file,String(now)])).code,0);
  if(mode==='claim'){
   const results=await Promise.all([run(child,['claim',dbPath,file,String(now)]),run(child,['claim',dbPath,file,String(now)])]);assert.ok(results.every(r=>r.code===0),JSON.stringify(results));assert.equal(results.reduce((n,r)=>n+Number(JSON.parse(r.stdout).claimed),0),1);
   console.log('PASS real concurrent processes claim one immutable relay job once');
  }else{
   assert.equal((await run(child,[mode,dbPath,file,String(now)])).code,mode==='result'?77:78);
   const store=createRelayStore({dbPath,now:()=>now+1001});let calls=0;
   const dispatcher=createDispatcher({store,boardAdapter:{kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId},assistantAdapter:{kind:'isolated-test',async answer(){calls++;throw Error('Must not invoke after restart');}},enabled:true});
   const result=await dispatcher.runOnce();assert.equal(calls,0);
   if(mode==='result'){assert.equal(result.status,'reconciled');assert.equal(store.get(p.eventId).state,'completed');assert.equal(JSON.parse(store.get(p.eventId).result_json).body,'Durable isolated result');console.log('PASS abrupt crash after durable result reconciles on restart with no second invocation');}
   else{assert.equal(result.status,'idle');assert.equal(store.get(p.eventId).state,'uncertain');console.log('PASS abrupt crash after invocation boundary becomes uncertain and never automatically invokes again');}
   assert.equal(store.consumeNonce('replay-fixture',now+120000),true);store.close();const reopened=createRelayStore({dbPath,now:()=>now+2000});assert.equal(reopened.consumeNonce('replay-fixture',now+120000),false);reopened.close();
  }
  passed++;
 }finally{cleanup(dir);}
}
const dir=mkdtempSync(path.join(tmpdir(),'oracle-bridge-startup-'));
try{
 const entry=path.join(root,'src/oracle-service.mjs'),secretFile=path.join(dir,'synthetic-secret'),dbPath=path.join(dir,'never-opened.db');writeFileSync(secretFile,'SYNTHETIC_ONLY_NOT_A_CREDENTIAL_1234567890');
 const disabled=await run(entry,[],{BRIDGE_ENABLED:'false'});assert.equal(disabled.code,0);assert.match(disabled.stdout,/disabled/);
 const blocked=await run(entry,[],{BRIDGE_ENABLED:'true',BRIDGE_HMAC_SECRET_FILE:secretFile,BRIDGE_KEY_ID:'test-key',BRIDGE_OWNER_ID:'owner',BRIDGE_ASSISTANT_ID:'axiom-test',BRIDGE_DB_PATH:dbPath});assert.equal(blocked.code,2);assert.match(blocked.stderr,/assistant_invocation_unavailable/);assert.equal(existsSync(dbPath),false);passed++;console.log('PASS production startup stays disabled or fails closed before DB/listener with the unavailable intended-Axiom adapter');
}finally{cleanup(dir);}
console.log(`${passed} isolated file-backed/process cases passed; no production or live assistant invocation.`);
