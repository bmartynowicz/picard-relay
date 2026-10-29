import assert from 'node:assert/strict';
import {createGroqAdapter,inputDigest} from '../src/groq-adapter.mjs';
import {createServer} from 'node:https';
import {groqHttpsFetch,loopbackTlsFixtureFetch} from '../src/https-fetch.mjs';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const certdir=mkdtempSync(join(tmpdir(),'relay-native-tls-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(certdir,'key.pem'),'-out',join(certdir,'cert.pem'),'-days','1','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1'],{stdio:'ignore'});
const key=readFileSync(join(certdir,'key.pem'),'utf8'),cert=readFileSync(join(certdir,'cert.pem'),'utf8');
const loopbackHttpFixtureFetch=(url,options)=>loopbackTlsFixtureFetch(url,options,cert);
let hits=0;
const server=createServer({key,cert},async(req,res)=>{hits++;let body='';for await(const x of req)body+=x;
 if(req.url==='/groq'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({id:'fixture-response',model:'openai/gpt-oss-20b',choices:[{finish_reason:'stop',message:{role:'assistant',content:'Hello World'}}]}));return;}
 if(req.url==='/oversize'){res.writeHead(200).end('x'.repeat(65537));return;}
 if(req.url==='/redirect'){res.writeHead(302,{location:'/ok'}).end();return;}
 if(req.url==='/slow'){setTimeout(()=>res.end('late'),100).unref();return;}
 res.writeHead(req.url==='/quota'?429:200,{'content-type':'application/json'});res.end(JSON.stringify({received:body,method:req.method}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`https://127.0.0.1:${server.address().port}`;
const opts={method:'POST',redirect:'error',body:'harmless',headers:{'Content-Type':'application/json'}};
try{
 assert.equal(typeof WebAssembly,'undefined','Run this transport proof with --jitless');
 await assert.rejects(loopbackTlsFixtureFetch(base+'/ok',opts,'-----BEGIN CERTIFICATE-----\ninvalid\n-----END CERTIFICATE-----'));
 const r=await loopbackHttpFixtureFetch(base+'/ok',opts);assert.equal(r.ok,true);assert.equal(r.status,200);const reader=r.body.getReader();let text='';while(true){const {value,done}=await reader.read();if(done)break;text+=Buffer.from(value);}
 assert.deepEqual(JSON.parse(text),{received:'harmless',method:'POST'});
 const q=await loopbackHttpFixtureFetch(base+'/quota',opts);assert.equal(q.status,429);assert.equal(q.ok,false);await q.body.cancel();
 const before=hits;await assert.rejects(loopbackHttpFixtureFetch(base+'/redirect',opts),/redirect_rejected/);assert.equal(hits,before+1);
 await assert.rejects(loopbackHttpFixtureFetch(base+'/slow',{...opts,signal:AbortSignal.timeout(10)}));
 const aborted=new AbortController();aborted.abort();const count=hits;await assert.rejects(loopbackHttpFixtureFetch(base+'/ok',{...opts,signal:aborted.signal}));assert.equal(hits,count);
 await assert.rejects(groqHttpsFetch(base+'/ok',opts),/endpoint_rejected/);
 await assert.rejects(groqHttpsFetch('https://api.groq.com/openai/v1/chat/completions?x=1',opts),/endpoint_rejected/);
 await assert.rejects(loopbackHttpFixtureFetch('http://example.com:80/',opts),/fixture_endpoint_rejected/);
 await assert.rejects(loopbackHttpFixtureFetch(base+'/ok',{...opts,method:'GET'}),/scope_rejected/);
 const input={owner:'fixture-owner',task:'fixture-task',requestId:'a'.repeat(64),invocationId:'a'.repeat(64),attempt:1,requestText:'Reply Hello World',context:{taskContext:{title:'Relay Hello World verification',nextAction:'',latestFinding:''}}};
 const now=Date.now();const gate={provider:'groq',model:'openai/gpt-oss-20b',accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,evidenceRef:'local fixture only',verifiedAt:now,validUntil:now+60000,owner:input.owner,task:input.task,requestId:input.requestId,inputSha256:inputDigest(input)};
 const adapter=createGroqAdapter({enabled:true,apiKey:'nonsecret-fixture',gate,fetchImpl:(_url,options)=>loopbackHttpFixtureFetch(base+'/groq',options)});
 assert.match((await adapter.answer(input)).body,/Hello World/);
 const oversized=createGroqAdapter({enabled:true,apiKey:'nonsecret-fixture',gate,fetchImpl:(_url,options)=>loopbackHttpFixtureFetch(base+'/oversize',options)});
 await assert.rejects(oversized.answer(input),/groq_outcome_uncertain/);
 console.log('PASS native transport: actual verified loopback TLS I/O under --jitless; body, status, redirects, cancellation, endpoint/method limits');
}finally{server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(certdir,{recursive:true,force:true});}
