// Read/install fixture only on the disposable GitHub runner, never on an owner host.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {request} from 'node:https';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const data='/var/lib/picard-relay',code='/opt/picard-relay';
const caFile='/var/lib/picard-relay-web/.local/share/caddy/pki/authorities/local/root.crt';
let cookie='';
async function call(url,body){
 const ca=fs.readFileSync(caFile);
 return new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port:443,servername:'picard.localhost',ca,path:url,method:body?'POST':'GET',headers:{host:'picard.localhost',origin:'https://picard.localhost','sec-fetch-site':'same-origin','content-type':'application/json',cookie}},res=>{
  let raw='';res.setEncoding('utf8');res.on('data',value=>{raw+=value;assert.ok(raw.length<262144);});res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:JSON.parse(raw)}));
 });req.setTimeout(5000,()=>req.destroy(Error('fixture_https_timeout')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
}
try{
 assert.equal(JSON.parse(fs.readFileSync(code+'/installation.json')).updaterEnrolled,false);
 let ready=false;
 for(let i=0;i<50;i++){try{if((await call('/auth/state')).status===200){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
 assert.equal(ready,true,'Installed services did not serve verified local HTTPS');
 assert.equal((await call('/workspace/config')).status,401);
 const setupCode=fs.readFileSync('/etc/picard-relay/first-sign-in.txt','utf8').match(/Setup code: (.+)/)[1];
 const setup=await call('/auth/setup',{setupCode,password:'Synthetic GitHub VM owner password only 8!'});assert.equal(setup.status,200);
 cookie=setup.headers['set-cookie'][0].split(';')[0];assert.match(setup.headers['set-cookie'][0],/Secure/);
 const workspace=await call('/workspace/config');assert.equal(workspace.status,200);assert.equal(workspace.body.ready,true);
 assert.deepEqual(workspace.body.usage.jobs,[]);assert.deepEqual(fs.readdirSync(data+'/markers'),[]);
 const digest=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
 const files=['/etc/picard-relay/credentials/groq',data+'/owner-auth/auth-state.json',data+'/relay.db'],before=files.map(digest);
 const rerun=spawnSync('/usr/bin/bash',['scripts/setup-linux.sh'],{encoding:'utf8',timeout:5000});
 // A noninteractive rerun must stop before reading credentials or writing anything.
 assert.notEqual(rerun.status,0);assert.deepEqual(files.map(digest),before);
 console.log(JSON.stringify({state:'fresh_host_services_passed',platform:'Ubuntu 24.04 x86-64 GitHub VM',actualInstaller:true,systemdServices:2,tls:'local CA explicitly trusted by fixture client; verification enabled',ownerSetup:true,workspaceReady:true,modelRequests:0,markers:0,rerunChangedState:false,publicAcmeQualified:false}));
}finally{spawnSync('/usr/bin/systemctl',['disable','--now','picard-relay.service','picard-relay-web.service'],{timeout:30000,stdio:'ignore'});}
