// Loopback-only synthetic qualification. Never reads a real key or relay state.
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildLanding} from './landing/build-static.mjs';
import {workspaceFixture,fixtureToken} from '../test/fixtures/workspace-fixture.mjs';
import {createPublicTestHandler} from '../experimental/runtime-control/src/admission-handler.mjs';
const port=Number(process.env.PICARD_PUBLIC_PREVIEW_PORT??54322);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('preview_port');
const origin='https://127.0.0.1:'+port,local='http://127.0.0.1:'+port;
const f=await workspaceFixture({realMarkers:false,publicTestEnabled:true,answerText:'1. Check System for relay health.\n2. Write a useful task in Requests and review it.\n3. Reopen the saved answer from Jobs.'});f.binding.publicTestOrigin=origin;
const dir=await mkdtemp(join(tmpdir(),'picard-public-preview-'));await buildLanding({outputDir:dir});
const handler=createPublicTestHandler({enabled:true,proxyConfigured:true,auth:{authenticate:async t=>t===fixtureToken},store:f.store,binding:f.binding,origins:[origin],publicOrigin:origin,now:f.now,loadPolicy:()=>f.policy,currentAvailability:f.router.availability});
const files=new Map([['/','index.html'],...['console.css','landing.css','landing.js','setup-flow.js','learning-guide.js','public-test.js','mark.svg'].map(n=>['/'+n,n])]);
const server=createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin!==undefined&&req.headers.origin!==local){res.writeHead(403);res.end();return;}
 if(req.url.startsWith('/public-test/')){
  // Local preview proxy only. Production continues to require real HTTPS,
  // owner authentication and a deployed Caddy header overwrite.
  req.headers.origin=origin;req.headers['sec-fetch-site']='same-origin';req.headers['x-picard-public-client-ip']='192.0.2.1';
  if(req.url.startsWith('/public-test/owner')||req.url==='/public-test/manage')req.headers.cookie='__Host-PicardSession='+fixtureToken;
  const oldWrite=res.writeHead.bind(res);res.writeHead=(status,headers)=>oldWrite(status,{...headers,...(headers?.['Access-Control-Allow-Origin']?{'Access-Control-Allow-Origin':local}:{})});
  if(await handler(req,res))return;
 }
 const file=files.get(req.url);if(!file||!['GET','HEAD'].includes(req.method)){res.writeHead(404);res.end();return;}
 let text=await readFile(join(dir,file),'utf8');
 if(file==='public-test.js')text=text.replace('https://picard-relay.141-148-50-78.sslip.io',local);
 if(file==='index.html')text=text.replace('connect-src https://picard-relay.141-148-50-78.sslip.io','connect-src '+local).replace('Your server. Your workspace.','Local trial preview · sample answers · no external AI calls');
 const type=file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':file.endsWith('.svg')?'image/svg+xml':'text/html';
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:text);
});
let working=false;const timer=setInterval(async()=>{if(working)return;working=true;try{await f.dispatcher.runOnce();}finally{working=false;}},1000);
server.listen(port,'127.0.0.1',()=>console.log('Synthetic public trial: '+local+'\nOwner controls: '+local+'/public-test/manage\nNo real key or provider calls.'));
async function close(){clearInterval(timer);await new Promise(r=>server.close(r));f.close();await rm(dir,{recursive:true,force:true});}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
