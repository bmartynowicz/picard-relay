import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {consoleSnapshot,CONSOLE_HTML,contributionRecognition,createConsoleHandler,createContributionRecognition} from '../src/oracle-service.mjs';
import {recordedGroqKeyExpiry} from '../src/admission-enrollment.mjs';
const now=new Date('2026-10-30T15:00:00Z'),health={serviceReady:true,resultRecoveryReady:true,providerReady:false,acceptingNewWork:false,draining:false,updateReady:true,releaseHash:'a'.repeat(64),pid:123,owner:'secret-owner',ledgerStateCounts:{completed:999},key:'SECRET'};
test('scoped projection never exports raw health/global totals',()=>{const s=consoleSnapshot(health,[{state:'completed',count:1}],now);assert.deepEqual(s.jobs,{queued:0,claimed:0,invoking:0,completed:1,failed:0,blocked:0,cancelled:0,uncertain:0});assert.equal(s.service.providerReady,false);assert.equal(s.release.version,null);assert.equal(s.updater.state,'unknown');assert.equal(s.observedAt,now.toISOString());assert.doesNotMatch(JSON.stringify(s),/SECRET|secret-owner|999|pid|ledgerStateCounts/);});
test('malformed counts and health stay unknown, release requires physical verification',()=>{for(const rows of [null,undefined,[{state:'completed',count:10001}],[{state:'completed',count:1},{state:'completed',count:2}],[{state:'bad',count:0}]])assert.deepEqual(consoleSnapshot(health,rows,now).jobs,{queued:null,claimed:null,invoking:null,completed:null,failed:null,blocked:null,cancelled:null,uncertain:null});assert.equal(consoleSnapshot({...health,updateReady:false},[],now).release.hash,null);assert.equal(consoleSnapshot({},[],now).service.ready,null);});
test('integrated candidate UI has pinned self-contained bytes',()=>{assert.equal(Buffer.byteLength(CONSOLE_HTML),104885);assert.equal(createHash('sha256').update(CONSOLE_HTML).digest('hex'),'076f7b3612d2640350440c616b61f20225d03d7555bd1d88b1b26f1f4f113f3f');});

test('a recorded key expiry must match the active key and only the date reaches status',()=>{
 const keySha256='b'.repeat(64),expiresAt='2026-11-03T12:00:00.000Z';
 const record={v:1,keySha256,expiresAt};
 const date=recordedGroqKeyExpiry(record,keySha256);
 assert.equal(date,Date.parse(expiresAt));
 for(const value of [null,{...record,v:2},{...record,keySha256:'c'.repeat(64)},
  {...record,expiresAt:'2026-02-30T12:00:00.000Z'},{...record,expiresAt:'2026-11-03'},
  {...record,grantExpiresAt:expiresAt}]) assert.equal(recordedGroqKeyExpiry(value,keySha256),null);
 assert.equal(recordedGroqKeyExpiry(record,undefined),null);
 const status=consoleSnapshot(health,[],now,'owner',null,date);
 assert.equal(status.groqKeyExpiresAt,date);
 assert.ok(!JSON.stringify(status).includes(keySha256));
 for(const blockingCode of ['configuration_unavailable','catalogue_unavailable']){
  assert.equal(consoleSnapshot({...health,blockingCode},[],now,'owner',null,date).groqKeyExpiresAt,null);
 }
 assert.equal(consoleSnapshot(health,[],now,'owner',null,null).groqKeyExpiresAt,null);
 assert.ok(!Object.hasOwn(consoleSnapshot(health,[],now),'groqKeyExpiresAt'));
});
await import('./core-bundle.test.mjs');
await import('./vm-power.test.mjs');

test('recognition is opt-in, bounded, and visible only in authenticated status', async()=>{
 const recognition=contributionRecognition('{"kills":[12,14],"captures":[16]}');
 assert.equal(recognition,'2 Kills · 1 Capture');
 for(const value of [undefined,'{}','{"kills":[],"captures":[]}','{"kills":[1],"captures":[1]}','{"kills":[1,1],"captures":[]}','{"kills":["1"],"captures":[]}','x'.repeat(4097)])assert.equal(contributionRecognition(value),'');
 const handler=createConsoleHandler({enabled:true,html:CONSOLE_HTML,recognition,origins:['https://fixture.invalid'],
  auth:{authenticate:token=>token==='a'.repeat(43)},getSnapshot:()=>({v:1})});
 const get=async(url,cookie)=>{
  const response={writeHead(status){this.status=status},end(body){this.body=body}};
  assert.equal(await handler({method:'GET',url,headers:{host:'fixture.invalid',cookie}},response),true);
  return response;
 };
 assert.doesNotMatch((await get('/')).body,/2 Kills|1 Capture/);
 assert.equal((await get('/status')).status,401);
 assert.deepEqual(JSON.parse((await get('/status','__Host-PicardSession='+'a'.repeat(43))).body),{v:1,recognition});
});

test('automatic recognition checks on authenticated demand and applies label additions and removals', async()=>{
 let now=0;
 const reads=[];
 const sync=createContributionRecognition({login:'fixture-user',now:()=>now,lookup:(login,{signal})=>{
  assert.equal(login,'fixture-user');
  return new Promise((resolve,reject)=>reads.push({resolve,reject,signal}));
 }});
 const handler=createConsoleHandler({enabled:true,html:CONSOLE_HTML,recognition:sync.read,
  origins:['https://fixture.invalid'],auth:{authenticate:token=>token==='a'.repeat(43)},getSnapshot:()=>({v:1})});
 const get=async(url,signedIn=false)=>{
  const response={writeHead(status){this.status=status;},end(body){this.body=body;}};
  const cookie=signedIn?'__Host-PicardSession='+'a'.repeat(43):undefined;
  assert.equal(await handler({method:'GET',url,headers:{host:'fixture.invalid',cookie}},response),true);
  return response;
 };
 const status=async()=>JSON.parse((await get('/status',true)).body);
 const tick=()=>new Promise(resolve=>setImmediate(resolve));
 assert.equal((await get('/')).status,200);
 assert.equal((await get('/status')).status,401);
 assert.equal(reads.length,0);
 assert.deepEqual(await status(),{v:1});
 assert.deepEqual(await status(),{v:1});
 assert.equal(reads.length,1);
 reads[0].resolve({kills:[40],captures:[]});
 await tick();
 assert.equal((await status()).recognition,'1 Kill · 0 Captures');
 now=599999;
 assert.equal((await status()).recognition,'1 Kill · 0 Captures');
 assert.equal(reads.length,1);
 now++;
 assert.equal((await status()).recognition,'1 Kill · 0 Captures');
 reads[1].resolve({kills:[],captures:[60]});
 await tick();
 assert.equal((await status()).recognition,'0 Kills · 1 Capture');
 now+=600000;
 await status();
 reads[2].reject(Error('GitHub unavailable'));
 await tick();
 assert.equal((await status()).recognition,'0 Kills · 1 Capture');
 now+=600000;
 await status();
 reads[3].resolve({kills:[],captures:[]});
 await tick();
 assert.deepEqual(await status(),{v:1});
 now+=600000;
 await status();
 sync.close();
 assert.equal(reads[4].signal.aborted,true);
 reads[4].resolve({kills:[50],captures:[]});
 await tick();
 assert.deepEqual(await status(),{v:1});
 assert.equal(reads.length,5);
});
