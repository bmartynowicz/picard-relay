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
 const c={enabled:true,keyId:e.BRIDGE_KEY_ID??'',secret,ownerId:e.BRIDGE_OWNER_ID??'',assistantId:e.BRIDGE_ASSISTANT_ID??'',allowedTaskId:e.BRIDGE_ALLOWED_TASK_ID??'',dbPath:e.BRIDGE_DB_PATH??'',port:Number(e.BRIDGE_PORT??8787),stopPath:e.BRIDGE_STOP_PATH??null};
 if(c.assistantId==='groq:openai/gpt-oss-20b'&&(!c.allowedTaskId||c.allowedTaskId.length>200))throw Error('production_configuration_unavailable');
 if(!validConfig(c)||!c.ownerId||!c.assistantId||!c.dbPath||c.dbPath===':memory:'||!Number.isSafeInteger(c.port)||c.port<1024||c.port>65535||e.BRIDGE_LOCAL_TEST_MODE==='true')throw Error('production_configuration_unavailable');
 return c;
}
export async function main(){
 const config=loadOracleConfig();if(!config.enabled){console.log(JSON.stringify({state:'disabled'}));return;}
 // No provider/API/model/command fallback. An unavailable selected adapter
 // fails before opening a port; Groq requires explicit bounded configuration.
 const assistantAdapter=createSelectedAssistantAdapter();
 if((assistantAdapter.ready!==true&&assistantAdapter.canServeResults!==true)||assistantAdapter.assistantId!==config.assistantId)throw Error('assistant_invocation_unavailable');
 const store=createRelayStore(config),receiver=createReceiver({store,config,assistantAdapter});
 const boardAdapter={kind:'signed-relay-result-ledger',scopeEnforced:true,getTaskContext:store.getTaskContext,appendReply:store.appendReply,getReplyByRequestId:store.getReplyByRequestId};
 const dispatcher=createDispatcher({store,boardAdapter,assistantAdapter,production:true,enabled:true,dbPath:config.dbPath,workerId:'oracle-relay',claimTtlMs:60000});
 let stopping=false,busy=false;
 const server=createServer(async(req,res)=>{try{
  // TLS terminates at the separately configured reverse proxy; loopback only.
  if(req.method!=='POST'||req.url!=='/bridge/v1'){res.writeHead(404).end();return;}
  let bytes=0,chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>24576){res.writeHead(413).end();req.destroy();return;}chunks.push(chunk);}
  const request=new Request('https://relay.invalid/bridge/v1',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}),reply=await receiver(request);
  res.writeHead(reply.status,Object.fromEntries(reply.headers));res.end(await reply.text());
 }catch{res.writeHead(503).end();}});
 server.requestTimeout=10000;server.headersTimeout=5000;server.maxConnections=16;
 await new Promise(resolve=>server.listen(config.port,'127.0.0.1',resolve));
 const timer=setInterval(async()=>{if(stopping||busy)return;if(config.stopPath&&existsSync(config.stopPath)){shutdown();return;}busy=true;try{const result=await dispatcher.runOnce();if(result.status!=='idle')console.log(JSON.stringify({state:result.status,eventId:result.requestId,attempt:result.attempt,code:result.code}));}finally{busy=false;if(stopping)store.close();}},1000);
 function shutdown(){if(stopping)return;stopping=true;clearInterval(timer);server.close();if(!busy)store.close();}
 process.once('SIGTERM',shutdown);process.once('SIGINT',shutdown);
 console.log(JSON.stringify({state:'started',storage:'file',bind:'loopback'}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({state:'startup_blocked',code:error.message==='assistant_invocation_unavailable'?error.message:'configuration_or_startup_failed'}));process.exitCode=2;});
