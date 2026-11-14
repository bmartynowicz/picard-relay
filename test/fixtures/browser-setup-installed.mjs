// Actual first-run installer and HTTPS on a disposable public CI VM only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {request} from 'node:https';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.env.GITHUB_ACTIONS,'true');
const code='/usr/local/lib/board-event-relay',state='/var/lib/board-event-relay',config='/etc/board-event-relay',first='/var/lib/picard-first-run';
const claim=fs.readFileSync('/run/picard-browser-fixture-claim','utf8'),hash=b=>createHash('sha256').update(b).digest('hex');
const run=(exe,args,timeout=450000)=>{const r=spawnSync(exe,args,{encoding:'utf8',timeout,maxBuffer:32768});assert.equal(r.status,0,r.stdout+'\n'+r.stderr);return r.stdout.trim();};
let cookie='';
async function call(url,body){const ca=fs.readFileSync('/var/lib/picard-relay-web/.local/share/caddy/pki/authorities/local/root.crt');return new Promise((resolve,reject)=>{const r=request({host:'127.0.0.1',port:443,servername:'picard.localhost',ca,path:url,method:body?'POST':'GET',headers:{host:'picard.localhost',origin:'https://picard.localhost','sec-fetch-site':'same-origin','content-type':'application/json',cookie}},res=>{let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)});}catch{reject(Error('fixture_response_not_json'));}});});r.setTimeout(5000,()=>r.destroy(Error('fixture_timeout')));r.on('error',reject);r.end(body?JSON.stringify(body):undefined);});}
async function poll(url,done){for(let i=0;i<180;i++){try{const r=await call(url);if(done(r))return r;}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('first_run_poll_timeout:'+url);}
await poll('/auth/state',r=>r.status===200&&!r.body.enrolled);
assert.equal((await call('/setup/progress')).status,401);
const owner=await call('/auth/setup',{setupCode:claim,password:'Synthetic installed browser owner password!'});assert.equal(owner.status,200);cookie=owner.headers['set-cookie'][0].split(';')[0];assert.match(owner.headers['set-cookie'][0],/Secure/);
const auth=fs.readFileSync(state+'/owner-auth/auth-state.json'),hmac=fs.readFileSync(config+'/credentials/hmac');assert.ok(!auth.includes(claim));
assert.equal((await call('/setup/progress')).body.state,'waiting');
assert.equal((await call('/setup/groq',{v:1,requestId:randomUUID(),apiKey:'bad'})).status,400);
const input={v:1,requestId:randomUUID(),apiKey:'gsk_SYNTHETIC_QUALIFICATION_ONLY_NOT_A_KEY',organizationId:'org_synthetic_no_provider',projectId:'proj_synthetic_no_provider',accountLabel:'Synthetic browser qualification',freeConfirmed:true,keyProjectConfirmed:true};
// A stopped first-run process may lose the response AFTER durable acceptance.
// Read progress only; never resubmit the key or create another request ID.
try{const r=await call('/setup/groq',input);assert.equal(r.status,202);}catch(e){if(e.code!=='ECONNRESET')throw e;}
await poll('/workspace/config',r=>r.status===200&&r.body.ready===true&&JSON.parse(fs.readFileSync(first+'/status.json')).state==='ready');
assert.ok(fs.readFileSync(state+'/owner-auth/auth-state.json').equals(auth));assert.ok(fs.readFileSync(config+'/credentials/hmac').equals(hmac));
assert.deepEqual(fs.readdirSync(state+'/markers'),[]);assert.deepEqual((await call('/workspace/config')).body.usage.jobs,[]);
assert.equal((await call('/updates')).body.enabled,true);assert.equal((await call('/groq/key')).body.enabled,true);
assert.equal(fs.existsSync(first+'/claimed-request.json'),false);assert.equal(fs.existsSync(first+'/inbox/request.json'),false);
assert.equal(JSON.parse(fs.readFileSync(first+'/status.json')).state,'ready');
for(const service of ['picard-first-run.service','picard-first-run-activate.path'])assert.notEqual(spawnSync('/usr/bin/systemctl',['is-active',service]).status,0);
const before=[state+'/owner-auth/auth-state.json',config+'/credentials/groq',state+'/relay.db'].map(p=>hash(fs.readFileSync(p)));
assert.notEqual(spawnSync('/usr/bin/bash',['scripts/setup-linux.sh','--browser'],{timeout:5000,stdio:'ignore'}).status,0);
assert.deepEqual([state+'/owner-auth/auth-state.json',config+'/credentials/groq',state+'/relay.db'].map(p=>hash(fs.readFileSync(p))),before);
console.log(JSON.stringify({state:'browser_first_run_installed_passed',actualInstaller:true,verifiedLocalHttps:true,ownerPasswordCreated:true,freeEnrollmentConnected:true,ownerAndHmacPreserved:true,updateAndReplaceKeyEnabled:true,temporaryServiceRetired:true,rerunChangedState:false,externalModelCalls:0,publicAcmeQualified:false}));
// Reuse the normal installed-host test for real Update, Replace key, an old
// synthetic saved answer, and new work. Its setup step is skipped explicitly.
process.env.PICARD_BROWSER_ALREADY_ENROLLED='true';process.env.PICARD_BROWSER_COOKIE=cookie;
await import('./setup-linux-installed.mjs');
