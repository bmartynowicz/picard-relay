// Explicit local preview. It exercises production workspace handlers and the
// durable queue with a synthetic adapter. No provider credentials or network.
import {createServer} from 'node:http';
import {workspaceFixture,fixtureToken,fixtureOrigin} from '../test/fixtures/workspace-fixture.mjs';
import {CONSOLE_HTML,createConsoleHandler,consoleSnapshot} from '../experimental/runtime-control/src/oracle-service.mjs';
import {admissionConsoleHtml} from '../experimental/runtime-control/src/admission-ui.mjs';
const port=Number(process.env.PICARD_PREVIEW_PORT??4391);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid preview port.');
const fixture=await workspaceFixture({realMarkers:false});
const accepted=Number(process.env.PICARD_PREVIEW_ACCEPTED_RESULTS??0);
if(![0,1,5,25].includes(accepted))throw Error('Use 0, 1, 5 or 25 synthetic accepted results.');
for(let i=0;i<accepted;i++){
 if(i)fixture.advance(61000);
 const d=await fixture.prepare(fixture.brief({title:'Synthetic accepted result '+(i+1)}));await fixture.submit(d,await fixture.approve(d));await fixture.dispatcher.runOnce();
 const saved=(await fixture.request('/workspace/requests/'+d.payload.eventId)).body;
 await fixture.request('/workspace/reviews/'+saved.ref,{body:{expectedRevision:0,decision:'accepted',note:'Synthetic preview only',resultSha256:saved.result.sha256}});
}
// Fixture clock was advanced only to seed the synthetic queue. Bring it back to
// wall time for real browser freshness checks. No production ledger is involved.
if(accepted>1)fixture.advance(-(accepted-1)*61000);
let signedIn=true,dispatching=false;
let updateState={v:1,enabled:true,state:'idle',requestedAt:null,finishedAt:null,retryAt:null};
const html=admissionConsoleHtml(CONSOLE_HTML,{activationEnabled:true,workspaceEnabled:true}).replace('</style>','.preview-banner{position:relative;z-index:3;padding:9px 24px;border-bottom:1px solid #303b3f;color:#dec387;font:13px system-ui}</style>').replace('<body>','<body><div class="preview-banner">Local v1 preview · synthetic answers · no external AI calls</div>');
const handler=createConsoleHandler({enabled:true,html,origins:['https://127.0.0.1:'+port],updates:{status:()=>updateState,request:()=>{updateState={v:1,enabled:true,state:'checking',requestedAt:Date.now(),finishedAt:null,retryAt:null};setTimeout(()=>{updateState={...updateState,state:'up_to_date',finishedAt:Date.now()};},1500);return updateState;}},auth:{readPublicState:()=>({enrolled:true}),authenticate:()=>signedIn,logout:()=>{signedIn=false;return true;},login:()=>{signedIn=true;return {token:fixtureToken,expiresAt:Date.now()+3600000};}},getSnapshot:()=>consoleSnapshot({serviceReady:true,resultRecoveryReady:true,providerReady:true,acceptingNewWork:true,draining:false,blockingCode:'ready'},fixture.store.relay.scopedStats({ownerId:fixture.binding.ownerId}),new Date(),'owner'),getRecentJobs:query=>fixture.store.relay.recentJobs({...query,ownerId:fixture.binding.ownerId})});
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/workspace/')){
  if(!signedIn){res.writeHead(401,{'Content-Type':'application/json'});res.end('{"error":"auth_failed"}');return;}
  const oldHost=req.headers.host,oldOrigin=req.headers.origin;
  if(oldHost!=='127.0.0.1:'+port||oldOrigin!==undefined&&oldOrigin!=='http://127.0.0.1:'+port){res.writeHead(403);res.end();return;}
  req.headers.host='fixture.invalid';req.headers.origin=fixtureOrigin;req.headers.cookie='__Host-PicardSession='+fixtureToken;
  if(await fixture.handler(req,res))return;
 }
 // Production handlers retain their HTTPS-only origin contract. The preview
 // supplies a local proxy shim without changing the shipped runtime.
 if(req.headers.origin==='http://127.0.0.1:'+port)req.headers.origin='https://127.0.0.1:'+port;
 req.headers.cookie='__Host-PicardSession='+fixtureToken;
 if(!await handler(req,res)){res.writeHead(404);res.end();}
});
const timer=setInterval(async()=>{if(dispatching)return;dispatching=true;try{await fixture.dispatcher.runOnce();}finally{dispatching=false;}},1000);
server.once('error',error=>{clearInterval(timer);fixture.close();console.error('Preview listener unavailable:',error.code);process.exitCode=1;});
server.listen(port,'127.0.0.1',()=>console.log('Picard v1 local fixture: http://127.0.0.1:'+port+'/#requests'));
async function close(){clearInterval(timer);await new Promise(r=>server.close(r));fixture.close();}
process.once('SIGTERM',()=>void close());process.once('SIGINT',()=>void close());
