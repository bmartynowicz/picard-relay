import fs from 'node:fs';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {createOwnerAuth,createConsoleHandler} from '../experimental/runtime-control/src/oracle-service.mjs';
import {BOOTSTRAP_ROOT,BOOTSTRAP_CONFIG,providerEnrollmentFiles,validateBrowserSetupConfig} from './browser-setup-core.mjs';
import {setupPaths} from './setup-linux-core.mjs';
import {BROWSER_SETUP_HTML} from './browser-setup-ui.mjs';
export function createBrowserSetupHandler({auth,config,identity,enqueue,readStatus=()=>({state:'waiting'}),html=BROWSER_SETUP_HTML}={}){
 validateBrowserSetupConfig(config);const origin='https://'+config.hostname;
 const consoleHandler=createConsoleHandler({enabled:true,html,auth,origins:[origin]});let writing=false;
 const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
 return async(req,res)=>{
  if(!['/setup/progress','/setup/groq'].includes(req.url)){
   if(!['/','/auth/state','/auth/setup','/auth/login','/auth/logout'].includes(req.url))return false;
   return consoleHandler(req,res);
  }
  const reply=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));return true;};
  if(req.headers.host!==config.hostname||req.headers.authorization!==undefined||req.headers.origin!==undefined&&req.headers.origin!==origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site']))return reply(403,{error:'auth_failed'});
  const cookies=String(req.headers.cookie??'').split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-PicardSession='));
  const sessionToken=cookies.length===1?cookies[0].slice('__Host-PicardSession='.length):'';
  if(!await auth.authenticate(sessionToken))return reply(401,{error:'auth_failed'});
  if(req.url==='/setup/progress'&&req.method==='GET')return reply(200,readStatus());
  if(req.url!=='/setup/groq'||req.method!=='POST')return reply(405,{error:'method_not_allowed'});
  if(req.headers.origin!==origin)return reply(403,{error:'auth_failed'});
  if(!await auth.authenticate(sessionToken,{fresh:true}))return reply(428,{error:'recent_owner_sign_in_required'});
  if(writing||readStatus().state!=='waiting')return reply(409,{error:'connection_already_submitted'});
  writing=true;let raw;
  try{
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))return reply(400,{error:'request_invalid'});
   let count=0;const parts=[];for await(const c of req){count+=c.length;if(count>2048)return reply(413,{error:'request_invalid'});parts.push(c);}
   raw=Buffer.concat(parts);let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch{return reply(400,{error:'request_invalid'});}
   if(!input||Object.hasOwn(input,'sessionToken'))return reply(400,{error:'request_invalid'});
   const request={...input,sessionToken};
   try{providerEnrollmentFiles(request,{hostname:config.hostname,identity});}catch{return reply(400,{error:'request_invalid'});}
   if(!await auth.authenticate(sessionToken,{fresh:true}))return reply(428,{error:'recent_owner_sign_in_required'});
   await enqueue(request);input.apiKey='';request.apiKey='';return reply(202,{state:'connecting',requestId:input.requestId});
  }catch{return reply(503,{error:'connection_unconfirmed'});}finally{raw?.fill(0);writing=false;}
 };
}
export async function main(){
 const paths=setupPaths(),config=JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG+'/config.json','utf8')),identity=JSON.parse(fs.readFileSync(BOOTSTRAP_CONFIG+'/identity.json','utf8'));
 const auth=createOwnerAuth({stateDir:paths.state+'/owner-auth'});
 const readStatus=()=>{if(fs.existsSync(BOOTSTRAP_ROOT+'/inbox/request.json'))return {state:'connecting'};try{const v=JSON.parse(fs.readFileSync(BOOTSTRAP_ROOT+'/status.json','utf8'));return {state:['waiting','connecting','failed','ready'].includes(v.state)?v.state:'failed'};}catch{return {state:'failed'};}};
 const handler=createBrowserSetupHandler({auth,config,identity,readStatus,enqueue:async input=>{
  const file=BOOTSTRAP_ROOT+'/inbox/request.json',temp=BOOTSTRAP_ROOT+'/inbox/.request-'+input.requestId;
  const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  try{fs.fchmodSync(fd,0o600);fs.writeFileSync(fd,JSON.stringify(input));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  // link, rather than rename, refuses to overwrite an already accepted request.
  try{fs.linkSync(temp,file);}finally{fs.unlinkSync(temp);}
 }});
 const server=createServer(async(req,res)=>{try{if(await handler(req,res))return;res.writeHead(404).end();}catch{res.writeHead(503).end();}});
 server.headersTimeout=5000;server.requestTimeout=10000;server.maxConnections=8;
 await new Promise((ok,no)=>{server.once('error',no);server.listen(8787,'127.0.0.1',ok);});
 process.once('SIGTERM',()=>server.close());process.once('SIGINT',()=>server.close());
 console.log(JSON.stringify({state:'first_run_ready',bind:'loopback'}));return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Picard first-run unavailable.');process.exitCode=1;});
