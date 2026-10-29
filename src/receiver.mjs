import {verifyRequest,signedResponse,ProtocolError} from './protocol.mjs';
export function createReceiver({store,config,assistantAdapter}){
 return async function handle(request){
  if(new URL(request.url).pathname!=='/bridge/v1')return new Response(null,{status:404});
  let nonce;
  try{
   const checked=await verifyRequest(request,config,(n,e)=>store.consumeNonce(n,e));nonce=checked.nonce;const p=checked.payload;
   if(!p||p.v!==1||p.ownerId!==config.ownerId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
   const pilot=config.assistantId.startsWith('groq:');
   if(pilot&&(!config.allowedTaskId||(p.action!=='health'&&(p.action==='exchange'?p.payload?.taskId:p.taskId)!==config.allowedTaskId)))throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
   const ready=assistantAdapter.ready===true&&assistantAdapter.assistantId===config.assistantId&&assistantAdapter.kind!=='synthetic-local-test-only';
   let result;
   if(p.action==='health'&&Object.keys(p).length===3)result={ready,assistantId:config.assistantId,code:ready?'ready':'assistant_invocation_unavailable'};
   else if(p.action==='cancel'&&Object.keys(p).length===5&&typeof p.taskId==='string'&&p.taskId.length<=200&&typeof p.grantId==='string'&&p.grantId.length<=200){store.cancel(p.ownerId,p.taskId,p.grantId);result={state:'cancelled'};}
   else if(p.action==='result'&&Object.keys(p).length===6&&typeof p.taskId==='string'&&p.taskId.length>0&&p.taskId.length<=200&&typeof p.eventId==='string'&&/^[a-f0-9]{64}$/.test(p.eventId)&&typeof p.payloadHash==='string'&&/^[a-f0-9]{64}$/.test(p.payloadHash)){
    const row=store.get(p.eventId);
    if(!row)result={state:'blocked',code:'assistant_invocation_unavailable'};
    else {
     if(row.owner!==config.ownerId||row.task!==p.taskId||row.payload_hash!==p.payloadHash||JSON.parse(row.payload_json).assistantId!==config.assistantId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
     store.getTaskContext({owner:row.owner,task:row.task,requestId:row.event_id}); // retain expiry and revocation checks
     result={state:row.state,...(row.state==='completed'?{result:JSON.parse(row.result_json)}:{}),...(row.last_error?{code:row.last_error}:{})};
    }
   }
   else if(p.action==='exchange'&&Object.keys(p).length===4){
    if(p.payload?.ownerId!==config.ownerId||p.payload?.assistantId!==config.assistantId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    if(pilot&&(p.payload.request?.text!=='Reply Hello World'||p.payload.request?.answerTo!==null||p.payload.context?.title!=='Relay Hello World verification'||p.payload.context?.nextAction!==''||p.payload.context?.latestFinding!==''))throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    if(typeof assistantAdapter.acceptsWorkScope==='function'&&!assistantAdapter.acceptsWorkScope(p.payload))throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    // Polling an authenticated existing immutable job never consumes provider capacity.
    // accept() still validates the entire payload and rejects altered replay content.
    if(!ready&&!store.get(p.payload.eventId))throw Object.assign(Error('assistant_invocation_unavailable'),{code:'assistant_invocation_unavailable'});
    const row=await store.accept(p.payload);result={state:row.state,...(row.state==='completed'?{result:JSON.parse(row.result_json)}:{}),...(row.last_error?{code:row.last_error}:{})};
   }else throw new ProtocolError('invalid_request');
   return signedResponse(result,200,nonce,config);
  }catch(error){
   const allowed=['authentication_denied','replayed_request','owner_scope_denied','idempotency_conflict','scope_revoked','scope_expired','assistant_invocation_unavailable','invalid_work','body_too_large','invalid_json','invalid_request','queue_capacity'];
   const code=allowed.includes(error?.code)?error.code:'relay_unavailable',status=['authentication_denied','owner_scope_denied'].includes(code)?403:code==='replayed_request'||code==='idempotency_conflict'?409:['assistant_invocation_unavailable','relay_unavailable','queue_capacity'].includes(code)?503:400;
   return nonce?signedResponse({error:code},status,nonce,config):new Response(JSON.stringify({error:code}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
 };
}
