// Read/install fixture only on the disposable GitHub runner, never on an owner host.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const data='/var/lib/board-event-relay',code='/usr/local/lib/board-event-relay',configuration='/etc/board-event-relay';
const caFile='/var/lib/picard-relay-web/.local/share/caddy/pki/authorities/local/root.crt';
// The service UID cannot traverse the hosted runner's private home directory.
// Stage only the synthetic fixture, not the repository or credentials.
const fixture=fs.mkdtempSync('/tmp/picard-installed-fixture-');fs.chmodSync(fixture,0o755);
fs.copyFileSync(fileURLToPath(new URL('./setup-linux-seed.mjs',import.meta.url)),fixture+'/seed.mjs');fs.chmodSync(fixture+'/seed.mjs',0o444);
let cookie='';
async function call(url,body){
 const ca=fs.readFileSync(caFile);
 return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:443,servername:'picard.localhost',ca,path:url,method:body?'POST':'GET',headers:{host:'picard.localhost',origin:'https://picard.localhost','sec-fetch-site':'same-origin','content-type':'application/json',cookie}},res=>{
  let raw='';res.setEncoding('utf8');res.on('data',value=>{raw+=value;assert.ok(raw.length<262144);});res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)});}catch{reject(Error('fixture_non_json_response'));}});
 });req.setTimeout(5000,()=>req.destroy(Error('fixture_https_timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
}
try{
 const install=JSON.parse(fs.readFileSync(code+'/installation.json'));assert.equal(install.updaterEnrolled,true);assert.equal(install.keyReplacementEnrolled,true);
 let ready=false;
 for(let i=0;i<50;i++){try{if((await call('/auth/state')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(ready,true,'Installed services did not serve verified local HTTPS');
 assert.equal((await call('/workspace/config')).status,401);
 if(process.env.PICARD_BROWSER_ALREADY_ENROLLED==='true'){
  cookie=process.env.PICARD_BROWSER_COOKIE;assert.match(cookie,/^__Host-PicardSession=[A-Za-z0-9_-]{43}$/);
 }else{
  const setupCode=fs.readFileSync(configuration+'/first-sign-in.txt','utf8').match(/Setup code: (.+)/)[1];
  const setup=await call('/auth/setup',{setupCode,password:'Synthetic GitHub VM owner password only 8!'});assert.equal(setup.status,200);
  cookie=setup.headers['set-cookie'][0].split(';')[0];assert.match(setup.headers['set-cookie'][0],/Secure/);
 }
 const workspace=await call('/workspace/config');assert.equal(workspace.status,200);assert.equal(workspace.body.ready,true);
 assert.deepEqual(workspace.body.usage.jobs,[]);assert.deepEqual(fs.readdirSync(data+'/markers'),[]);
 const systemctl=(...args)=>{const r=spawnSync('/usr/bin/systemctl',args,{encoding:'utf8',timeout:40000,maxBuffer:8192});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 async function seed(){
  const pid=systemctl('show','board-event-relay.service','--property=MainPID','--value');assert.match(pid,/^[1-9][0-9]+$/);
  const active=fs.readFileSync('/proc/'+pid+'/environ');assert.ok(active.length<65536);
  const env=Object.fromEntries(active.toString('utf8').split('\0').filter(v=>/^(BRIDGE_|GROQ_)/.test(v)).map(v=>[v.slice(0,v.indexOf('=')),v.slice(v.indexOf('=')+1)]));
  assert.equal(systemctl('show','board-event-relay.service','--property=MainPID','--value'),pid);
  systemctl('stop','board-event-relay.service');
  const seeded=spawnSync('/usr/sbin/runuser',['-u','board-event-relay','--',code+'/node','--jitless',fixture+'/seed.mjs'],{cwd:'/',input:JSON.stringify({cookie,env}),encoding:'utf8',timeout:30000,maxBuffer:32768,env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',GITHUB_ACTIONS:'true',OPENSSL_CONF:'/etc/picard-updater/openssl.cnf'}});
  assert.equal(seeded.status,0,seeded.stdout+'\n'+seeded.stderr);const row=JSON.parse(seeded.stdout.split('\n').find(v=>v.startsWith('{"fixtureRef"')));assert.equal(row.externalModelCalls,0);
  systemctl('start','board-event-relay.service');return row;
 }
 async function poll(url,done){for(let i=0;i<450;i++){try{const r=await call(url);if(done(r))return r;}catch{}await new Promise(resolve=>setTimeout(resolve,200));}throw Error('fixture_read_only_poll_timeout:'+url);}
 const firstSeed=await seed(),firstRef=firstSeed.fixtureRef;const first=await poll('/workspace/requests/'+firstRef,r=>r.body.resultAvailable===true);
 const markerHashes=()=>fs.readdirSync(data+'/markers').sort().map(name=>[name,createHash('sha256').update(fs.readFileSync(data+'/markers/'+name)).digest('hex')]);
 const retained=markerHashes(),release=fs.readlinkSync(code+'/current');assert.equal(retained.length,1);
 assert.equal((await call('/updates')).body.enabled,true);assert.equal((await call('/groq/key')).body.enabled,true);
 const update=await call('/updates',{});assert.equal(update.status,202,JSON.stringify(update.body));
 const updated=await poll('/updates',r=>['up_to_date','installed','held','failed','unknown'].includes(r.body.state));assert.equal(updated.body.state,'up_to_date',JSON.stringify(updated.body));
 assert.equal(fs.readlinkSync(code+'/current'),release);assert.deepEqual(markerHashes(),retained);
 assert.equal((await call('/workspace/requests/'+firstRef)).body.result.body,first.body.result.body);
 const id=randomUUID(),key=await call('/groq/key',{id,key:'gsk_SYNTHETIC_ROTATED_QUALIFICATION_ONLY_1234',free:true});assert.equal(key.status,202,JSON.stringify(key.body));
 const replaced=await poll('/groq/key',r=>r.body.id===id&&['replaced','rejected','unknown'].includes(r.body.state));assert.equal(replaced.body.state,'replaced',JSON.stringify(replaced.body));
 assert.deepEqual(markerHashes(),retained);assert.equal((await call('/workspace/config')).body.ready,true);
 assert.equal((await call('/workspace/requests/'+firstRef)).body.result.body,first.body.result.body);
 const secondSeed=await seed(),secondRef=secondSeed.fixtureRef;assert.notEqual(secondRef,firstRef);assert.notEqual(secondSeed.enrollmentId,firstSeed.enrollmentId);
 const second=await poll('/workspace/requests/'+secondRef,r=>r.body.resultAvailable===true);assert.equal(second.body.resultAvailable,true);
 assert.equal((await call('/workspace/requests/'+firstRef)).body.result.body,first.body.result.body);assert.equal(markerHashes().length,2);
 const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const files=[configuration+'/credentials/groq',data+'/owner-auth/auth-state.json',data+'/relay.db'],before=files.map(digest);
 const rerun=spawnSync('/usr/bin/bash',['scripts/setup-linux.sh'],{encoding:'utf8',timeout:5000});
 // A noninteractive rerun must stop before reading credentials or writing anything.
 assert.notEqual(rerun.status,0);assert.deepEqual(files.map(digest),before);
 const osRelease=fs.readFileSync('/etc/os-release','utf8');
 console.log(JSON.stringify({state:'fresh_host_services_passed',platform:osRelease.match(/^PRETTY_NAME=(.+)$/m)?.[1],environment:process.env.PICARD_QUALIFICATION_ENV??'hosted-vm',architecture:process.arch,actualInstaller:true,signedRelease:true,updater:'up_to_date',keyReplacement:'replaced',oldResultPreserved:true,newWorkAfterReplacement:true,tls:'local CA explicitly trusted by fixture client; verification enabled',ownerSetup:true,workspaceReady:true,externalModelRequests:0,syntheticResponses:2,markers:2,rerunChangedState:false,publicAcmeQualified:false}));
}finally{spawnSync('/usr/bin/systemctl',['disable','--now','board-event-relay.service','picard-relay-web.service','picard-groq-replacement.socket','picard-owner-update.path','picard-updater.timer','picard-updater-activity.timer'],{timeout:30000,stdio:'ignore'});fs.rmSync(fixture,{recursive:true});}
