// Real verified loopback TLS; synthetic data only. No provider or real config.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {canonical,digest,signedResponse} from '../experimental/runtime-control/src/protocol.mjs';
import {createManualIntent} from '../tools/manual-client.mjs';
import {createNativeRelayTransport} from '../tools/manual-node.mjs';

test('manual client real TLS size and CLI polling deadlines',{skip:process.platform!=='linux'?'Qualify actual Linux private files and verified loopback TLS.':false},async t=>{
 const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-manual-tls-'));fs.chmodSync(root,0o700);
 const certFile=path.join(root,'cert.pem'),keyFile=path.join(root,'key.pem');let server;
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const ca=fs.readFileSync(certFile),secret='SYNTHETIC_TLS_SIGNING_FIXTURE_ONLY_0123456789',config={keyId:'fixture-key',secret};let calls=[],oversize=false;
  server=https.createServer({cert:ca,key:fs.readFileSync(keyFile)},async(req,res)=>{
   if(oversize){res.writeHead(200);res.write(Buffer.alloc(24576,65));res.end(Buffer.alloc(512,65));return;}
   let raw='';for await(const part of req)raw+=part;const body=JSON.parse(raw);calls.push(body.action);
   if(body.action==='result')return; // Wait must cancel this actual TLS request.
   const signed=await signedResponse({state:'queued'},200,req.headers['x-bridge-nonce'],config);
   res.writeHead(signed.status,Object.fromEntries(signed.headers));res.end(await signed.text());
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const origin='https://127.0.0.1:'+server.address().port;
  await t.test('actual IncomingMessage abort during size-limit destruction preserves exact code',async()=>{
   oversize=true;const transport=createNativeRelayTransport((url,options,cb)=>https.request(url,{...options,ca},cb));
   await assert.rejects(()=>transport(new Request(origin+'/bridge/v1',{method:'POST',redirect:'manual',body:'{}'})),e=>e.code==='response_too_large');oversize=false;
  });
  async function cliFixture(label){
   const dir=path.join(root,label);fs.mkdirSync(dir,{mode:0o700});const at=Date.now();
   const enrollment={v:1,owner:'fixture-owner',provider:'groq',model:'openai/gpt-oss-20b',accountLabel:'Synthetic TLS fixture',organizationId:'fixture-org',projectId:'fixture-project',keySha256:'a'.repeat(64),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-86400000,enrolledAt:at-10000,evidenceRef:'SYNTHETIC',keyAssociationEvidenceRef:'SYNTHETIC'};
   const gate={v:3,purpose:'sanitized-source-proposal',provider:'groq',model:enrollment.model,owner:enrollment.owner,task:'fixture-task',grantId:'fixture-grant-'+label,eventId:await digest(canonical([enrollment.owner,'fixture-task',label])),maxCalls:1,harmlessTestOnly:true,accountPlan:'Free',noPaidFallback:true,requestIssuedAt:at-1000,requestExpiresAt:at+60000,approvedRequestText:'Synthetic request only.',taskContext:{title:'Synthetic TLS',nextAction:'No provider',latestFinding:'No real data'},costEnrollment:enrollment,enrollmentId:await digest(canonical(enrollment))};gate.approvedInputSha256=await digest(canonical({requestText:gate.approvedRequestText,taskContext:gate.taskContext}));
   const intent=await createManualIntent({gate,requestId:label}),put=(name,value)=>{const file=path.join(dir,name);fs.writeFileSync(file,value,{mode:0o600});return file;};
   const gatePath=put('gate.json',JSON.stringify(gate)),intentPath=put('intent.json',JSON.stringify(intent)),secretPath=put('hmac',secret);
   const fields={BRIDGE_ENABLED:'true',BRIDGE_PROVIDER:'groq',GROQ_ENABLED:'true',GROQ_ONE_SHOT:'true',BRIDGE_OWNER_ID:enrollment.owner,BRIDGE_ALLOWED_TASK_ID:gate.task,BRIDGE_ASSISTANT_ID:'groq:'+gate.model,BRIDGE_KEY_ID:config.keyId,BRIDGE_CONSOLE_ORIGINS:JSON.stringify([origin]),GROQ_FREE_GATE_FILE:gatePath,BRIDGE_HMAC_SECRET_FILE:secretPath};
   return {dir,intentPath,configPath:put('runtime.env',Object.entries(fields).map(([k,v])=>k+'='+v).join('\n'))};
  }
  async function runCli(wait,label){
   const f=await cliFixture(label),file=fileURLToPath(new URL('../tools/manual-request.mjs',import.meta.url));
   const args=[...(process.execArgv.includes('--jitless')?['--jitless']:[]),file,'submit','--config',f.configPath,'--origin',origin,'--intent',f.intentPath,'--journal',path.join(f.dir,'journal'),'--wait-ms',String(wait)];
   const at=Date.now();const r=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,args,{env:{...process.env,NODE_EXTRA_CA_CERTS:certFile},stdio:['ignore','pipe','pipe']});let raw='',err='';child.stdout.on('data',d=>raw+=d);child.stderr.on('data',d=>err+=d);child.on('error',reject);child.on('close',code=>resolve({code,raw,err}));});
   assert.equal(r.code,0,r.err);const receipt=JSON.parse(r.raw);assert.equal(receipt.state,'queued');return {receipt,elapsed:Date.now()-at};
  }
  await t.test('1000ms CLI wait never starts an extra result request at the deadline',async()=>{
   calls=[];const r=await runCli(1000,'deadline-exact');assert.deepEqual(calls,['exchange']);assert.ok(r.elapsed<4000,'elapsed '+r.elapsed);assert.equal(r.receipt.submission,'sent_once');
  });
  await t.test('1500ms CLI wait aborts an in-flight real result read without another exchange',async()=>{
   calls=[];const r=await runCli(1500,'deadline-inflight');assert.deepEqual(calls,['exchange','result']);assert.equal(r.receipt.polling,'deadline_reached');assert.ok(r.elapsed<4000,'elapsed '+r.elapsed);
  });
 }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}fs.rmSync(root,{recursive:true,force:true});}
});
