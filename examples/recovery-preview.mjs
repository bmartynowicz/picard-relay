// Disposable browser qualification: local synthetic data only, no provider I/O.
import {createServer} from 'node:http';
import {workspaceFixture,fixtureToken,fixtureOrigin} from '../test/fixtures/workspace-fixture.mjs';
import {CONSOLE_HTML,createConsoleHandler,consoleSnapshot} from '../experimental/runtime-control/src/oracle-service.mjs';
import {admissionConsoleHtml} from '../experimental/runtime-control/src/admission-ui.mjs';

const port=Number(process.env.PICARD_PREVIEW_PORT??4395),scenario=process.env.PICARD_RECOVERY_SCENARIO??'states';
if(!Number.isSafeInteger(port)||port<1024||port>65535||!['states','lost-response'].includes(scenario))throw Error('preview_configuration');
const f=await workspaceFixture({realMarkers:false}),refs={};
async function seed(title){const d=await f.prepare(f.brief({title}));await f.submit(d,await f.approve(d));return d.payload.eventId;}
if(scenario==='states'){
 refs.completed=await seed('Synthetic retained answer');await f.dispatcher.runOnce();
 refs.uncertain=await seed('Synthetic outcome unknown');
 const claim=f.router.claimNext({workerId:'recovery-preview',claimTtlMs:1000});
 if(claim.request_id!==refs.uncertain)throw Error('fixture_order');
 f.store.relay.startInvocation({requestId:claim.request_id,workerId:'recovery-preview',attempt:claim.attempt});
 f.advance(1001);f.store.reconcileEligible([refs.uncertain]);
}
let drop=scenario==='lost-response';
const html=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true}).replace('<body>','<body><p role="note">Synthetic recovery preview · no provider calls</p>');
const handler=createConsoleHandler({enabled:true,html,origins:['https://127.0.0.1:'+port],auth:{readPublicState:()=>({enrolled:true}),authenticate:()=>true,logout:()=>true},getSnapshot:()=>consoleSnapshot({serviceReady:true,resultRecoveryReady:true,providerReady:true,acceptingNewWork:scenario==='lost-response',draining:false,blockingCode:'ready'},f.store.relay.scopedStats({ownerId:f.binding.ownerId}),new Date(),'owner'),getRecentJobs:q=>f.store.relay.recentJobs({...q,ownerId:f.binding.ownerId})});
const server=createServer(async(req,res)=>{
 if(req.headers.host!=='127.0.0.1:'+port||req.headers.origin!==undefined&&req.headers.origin!=='http://127.0.0.1:'+port){res.writeHead(403);res.end();return;}
 if(req.url==='/fixtures'&&req.method==='GET'){
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'"});
  res.end('<!doctype html><title>Synthetic recovery fixtures</title><h1>Local synthetic states · no provider calls</h1>'+Object.entries(refs).map(([state,ref])=>'<p><a href="/#requests/'+ref+'">'+state+'</a></p>').join(''));return;
 }
 if(req.url.startsWith('/workspace/')){
  req.headers.host='fixture.invalid';req.headers.origin=fixtureOrigin;req.headers.cookie='__Host-PicardSession='+fixtureToken;
  const captured={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=body;}};
  if(await f.handler(req,captured)){
   if(drop&&req.method==='POST'&&req.url==='/workspace/requests'&&captured.status===201){drop=false;req.socket.destroy();return;}
   res.writeHead(captured.status,captured.headers);res.end(captured.body);return;
  }
 }
 if(req.headers.origin==='http://127.0.0.1:'+port)req.headers.origin='https://127.0.0.1:'+port;
 req.headers.cookie='__Host-PicardSession='+fixtureToken;
 if(!await handler(req,res)){res.writeHead(404);res.end();}
});
server.once('error',e=>{f.close();console.error('Preview unavailable:',e.code);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({preview:'http://127.0.0.1:'+port,scenario,fixtures:'http://127.0.0.1:'+port+'/fixtures',providerCalls:0,syntheticAdapterCalls:f.calls})));
async function close(){await new Promise(r=>server.close(r));f.close();}
process.once('SIGINT',()=>void close());process.once('SIGTERM',()=>void close());
