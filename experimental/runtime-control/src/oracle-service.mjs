import {createRuntimeControl} from './runtime-control.mjs';
// In tribute to Sir Patrick Stewart. Make it so.
import {createServer} from 'node:http';
import {readFileSync,existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRelayStore} from './relay-store.mjs';
import {createReceiver} from './receiver.mjs';
import {createSelectedAssistantAdapter} from './selected-assistant.mjs';
import {createDispatcher} from './dispatcher.mjs';
import {validConfig} from './protocol.mjs';

export function loadOracleConfig(e=process.env){
 if(e.BRIDGE_ENABLED!=='true')return {enabled:false};
 const secret=e.BRIDGE_HMAC_SECRET_FILE?readFileSync(e.BRIDGE_HMAC_SECRET_FILE,'utf8').trim():'';
 const c={enabled:true,keyId:e.BRIDGE_KEY_ID??'',secret,ownerId:e.BRIDGE_OWNER_ID??'',assistantId:e.BRIDGE_ASSISTANT_ID??'',allowedTaskId:e.BRIDGE_ALLOWED_TASK_ID??'',dbPath:e.BRIDGE_DB_PATH??'',port:Number(e.BRIDGE_PORT??8787),stopPath:e.BRIDGE_STOP_PATH??null,controlSocket:e.BRIDGE_CONTROL_SOCKET??'',releaseHash:e.BRIDGE_RELEASE_HASH??''};
 if(c.assistantId==='groq:openai/gpt-oss-20b'&&(!c.allowedTaskId||c.allowedTaskId.length>200))throw Error('production_configuration_unavailable');
 if(!validConfig(c)||!c.ownerId||!c.assistantId||!c.dbPath||c.dbPath===':memory:'||!Number.isSafeInteger(c.port)||c.port<1024||c.port>65535||e.BRIDGE_LOCAL_TEST_MODE==='true')throw Error('production_configuration_unavailable');
 return c;
}
export async function main(){
 const config=loadOracleConfig();if(!config.enabled){console.log(JSON.stringify({state:'disabled'}));return;}
 return startOracleService(config,createSelectedAssistantAdapter());
}
export async function startOracleService(config,assistantAdapter,{intervalMs=1000,installSignals=true}={}){
 if(assistantAdapter?.localTestOnly===true||assistantAdapter?.kind==='controlled-local-fixture-only')throw Error('production_fixture_executor_forbidden');
 // No provider/API/model/command fallback. This is the sole external runtime
 // Unconfigured adapters fail closed; a spent one-shot adapter may serve saved results.
 if((assistantAdapter.ready!==true&&assistantAdapter.canServeResults!==true)||assistantAdapter.assistantId!==config.assistantId)throw Error('assistant_invocation_unavailable');
 let store,live=false;
 const control=createRuntimeControl({socketPath:config.controlSocket,releaseHash:config.releaseHash,stats:()=>store.stats(),providerReady:()=>assistantAdapter.ready===true,resultRecoveryReady:()=>live,serviceReady:()=>live});
 store=createRelayStore({...config,canAccept:()=>control.accepting});
 const receiver=createReceiver({store,config,assistantAdapter,canAccept:()=>control.accepting,runtimeHealth:()=>control.health()});
 const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter,production:true,enabled:true,dbPath:config.dbPath,workerId:'oracle-relay',claimTtlMs:60000});
 let stopping=false,shutdownPromise=null,finishBusy=null;
 const server=createServer(async(req,res)=>{try{
  // TLS terminates at the separately configured reverse proxy; loopback only.
  if(req.method!=='POST'||req.url!=='/bridge/v1'){res.writeHead(404).end();return;}
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>24576){res.writeHead(413).end();req.destroy();return;}chunks.push(chunk);}
  const request=new Request('https://relay.invalid/bridge/v1',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),reply=await receiver(request);
  res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());
 }catch{res.writeHead(503).end();}});
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=16;
 try{await control.start();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,'127.0.0.1',resolve);});}catch(e){await control.close();store.close();throw e;}
 live=true;
 const timer=setInterval(async()=>{if(stopping||!control.accepting||control.busy)return;if(config.stopPath&&existsSync(config.stopPath)){shutdown();return;}if(!control.tryBegin())return;try{const result=await dispatcher.runOnce();if(result.status!=='idle')console.log(JSON.stringify({state:result.status,eventId:result.requestId,attempt:result.attempt,code:result.code}));}finally{control.finish();if(finishBusy)finishBusy();}},intervalMs);
 function shutdown(){
  if(shutdownPromise)return shutdownPromise;
  stopping=true;control.drain();clearInterval(timer);
  shutdownPromise=(async()=>{
   await Promise.all([new Promise(resolve=>server.close(resolve)),control.close(),control.busy?new Promise(resolve=>{finishBusy=resolve;}):Promise.resolve()]);
   live=false;store.close();if(installSignals){process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);}
  })();return shutdownPromise;
 }
 if(installSignals){process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);}
 console.log(JSON.stringify({state:'started',storage:'file',bind:'loopback'}));
 return {shutdown,control,address:()=>server.address()};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({state:'startup_blocked',code:error.message==='assistant_invocation_unavailable'?error.message:'configuration_or_startup_failed'}));process.exitCode=2;});
