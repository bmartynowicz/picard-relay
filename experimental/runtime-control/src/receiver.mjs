import {verifyRequest,signedResponse,ProtocolError,validateWork,digest} from './protocol.mjs';
import {decodeInvocationError} from './adapters.mjs';
function resultError(value){const {code}=decodeInvocationError(value);return code==='invocation_in_progress'?{}:{code};}
const STATES=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'];
// Only aggregate allowlisted values cross the existing signed health boundary.
// No row, task, owner, result, error text, pid, path or environment is copied.
export function healthDiagnostics({rows=null,runtimeHealth=null,providerReady=false,accepting=false}={}){
 let ledgerStateCounts=null,jobsTotal=null,resultsTotal=null;
 if(Array.isArray(rows)&&rows.length<=STATES.length){
  const counts=Object.fromEntries(STATES.map(state=>[state,0]));let total=0,valid=true;const seen=new Set();
  for(const row of rows){if(!row||!STATES.includes(row.state)||seen.has(row.state)||!Number.isSafeInteger(row.count)||row.count<0||row.count>10000){valid=false;break;}seen.add(row.state);counts[row.state]=row.count;total+=row.count;}
  if(valid&&total<=10000){ledgerStateCounts=counts;jobsTotal=total;resultsTotal=counts.completed;}
 }
 const hash=runtimeHealth?.updateReady===true&&/^[a-f0-9]{64}$/.test(runtimeHealth.releaseHash??'')?runtimeHealth.releaseHash:null;
 return {v:1,serviceReady:runtimeHealth?.serviceReady===true,resultRecoveryReady:runtimeHealth?.resultRecoveryReady===true,providerReady:providerReady===true,acceptingNewWork:accepting===true&&providerReady===true,ledgerStateCounts,jobsTotal,resultsTotal,release:{state:hash?'identified':'unknown',hash},updater:{state:'unknown'},capabilities:{routing:'free-only-one-shot-v1',taskExecution:'local-fixture-only',productionTaskExecution:false}};
}
export function createReceiver({store,config,assistantAdapter,canAccept=()=>true,runtimeHealth=()=>null,gradeResult=null,readGrade=null}){
 async function gradeTarget(p){
  if(typeof p.taskId!=='string'||!p.taskId||p.taskId.length>200||typeof p.eventId!=='string'||!/^[a-f0-9]{64}$/.test(p.eventId)||typeof p.payloadHash!=='string'||!/^[a-f0-9]{64}$/.test(p.payloadHash))throw new ProtocolError('invalid_request');
  const row=store.get(p.eventId);if(!row||row.owner!==config.ownerId||row.task!==p.taskId||row.payload_hash!==p.payloadHash)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
  const original=await validateWork(JSON.parse(row.payload_json));
  if(original.ownerId!==config.ownerId||original.taskId!==p.taskId||original.assistantId!==config.assistantId||original.eventId!==p.eventId||original.payloadHash!==p.payloadHash)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
  try{store.getTaskContext({owner:row.owner,task:row.task,requestId:row.event_id});}catch{throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});} // Existing signed-client expiry/revocation boundary.
  let saved;try{saved=JSON.parse(row.result_json);}catch{throw Object.assign(Error('grade_unavailable'),{code:'grade_unavailable'});}
  if(row.state!=='completed'||saved?.v!==1||saved.eventId!==p.eventId||saved.ownerId!==original.ownerId||saved.taskId!==original.taskId||saved.requestId!==original.requestId||saved.grantId!==original.grantId||saved.assistantId!==original.assistantId||saved.payloadHash!==original.payloadHash||saved.responseId!=='resp:'+p.eventId||typeof saved.body!=='string'||!saved.body.trim()||saved.body.length>16000||!['information','question'].includes(saved.outcome?.kind))throw Object.assign(Error('grade_unavailable'),{code:'grade_unavailable'});
  return saved;
 }
 return async function handle(request){
  if(new URL(request.url).pathname!=='/bridge/v1')return new Response(null,{status:404});
  let nonce;
  try{
   const checked=await verifyRequest(request,config,(n,e)=>store.consumeNonce(n,e));nonce=checked.nonce;const p=checked.payload;
   if(!p||p.v!==1||p.ownerId!==config.ownerId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
   const pilot=config.assistantId.startsWith('groq:');
   const requestedTask=p.action==='exchange'?p.payload?.taskId:p.taskId;
   const reusableAllowed=config.admissionReusableBoardEnabled===true&&assistantAdapter.reusableBoardEnabled===true&&typeof assistantAdapter.permitsBoardTask==='function'&&assistantAdapter.permitsBoardTask({ownerId:p.ownerId,taskId:requestedTask,action:p.action})===true;
   if(pilot&&(!config.allowedTaskId||(p.action!=='health'&&requestedTask!==config.allowedTaskId&&!reusableAllowed)))throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
   const ready=canAccept()&&assistantAdapter.ready===true&&assistantAdapter.assistantId===config.assistantId&&assistantAdapter.localTestOnly!==true&&!['synthetic-local-test-only','controlled-local-fixture-only'].includes(assistantAdapter.kind);
   let result;
   if(p.action==='health'&&Object.keys(p).length===3){
    let rows=null,health=null;try{rows=store.scopedStats({ownerId:p.ownerId,allowedTaskId:config.allowedTaskId});}catch{}
    try{health=runtimeHealth();}catch{}
    result={ready,assistantId:config.assistantId,code:ready?'ready':'assistant_invocation_unavailable',...(config.admissionReusableBoardEnabled===true&&assistantAdapter.reusableBoardEnabled===true?{reusableBoard:true,approvedCompletionTokens:[512,4096]}:{}),diagnostics:healthDiagnostics({rows,runtimeHealth:health,providerReady:assistantAdapter.ready===true&&assistantAdapter.localTestOnly!==true&&!['synthetic-local-test-only','controlled-local-fixture-only'].includes(assistantAdapter.kind)&&assistantAdapter.assistantId===config.assistantId,accepting:ready})};
   }
   else if(p.action==='cancel'&&Object.keys(p).length===5&&typeof p.taskId==='string'&&p.taskId.length<=200&&typeof p.grantId==='string'&&p.grantId.length<=200){store.cancel(p.ownerId,p.taskId,p.grantId);result={state:'cancelled'};}
   else if(p.action==='result'&&Object.keys(p).length===6&&typeof p.taskId==='string'&&p.taskId.length>0&&p.taskId.length<=200&&typeof p.eventId==='string'&&/^[a-f0-9]{64}$/.test(p.eventId)&&typeof p.payloadHash==='string'&&/^[a-f0-9]{64}$/.test(p.payloadHash)){
    const row=store.get(p.eventId);
    if(!row)result={state:'blocked',code:'assistant_invocation_unavailable'};
    else {
     if(row.owner!==config.ownerId||row.task!==p.taskId||row.payload_hash!==p.payloadHash||JSON.parse(row.payload_json).assistantId!==config.assistantId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
     store.getTaskContext({owner:row.owner,task:row.task,requestId:row.event_id}); // retain expiry and revocation checks
     result={state:row.state,...(row.state==='completed'?{result:JSON.parse(row.result_json)}:{}),...(row.last_error?resultError(row.last_error):{})};
    }
   }
   else if(p.action==='grade_status'&&Object.keys(p).length===6&&config.workspaceEnabled===true&&typeof readGrade==='function'){
    const saved=await gradeTarget(p),grade=readGrade(p.eventId),hash=await digest(saved.body);if(grade.history.some(g=>g.resultSha256!==hash))throw Object.assign(Error('grade_invalid'),{code:'grade_invalid'});result={v:1,grade:{revision:grade.revision,latest:grade.latest}};
   }
   else if(p.action==='grade'&&Object.keys(p).length===10&&config.workspaceEnabled===true&&typeof gradeResult==='function'){
    await gradeTarget(p);
    const grade=gradeResult({ref:p.eventId,expectedRevision:p.expectedRevision,score:p.score,note:p.note,resultSha256:p.resultSha256,reviewer:{kind:'client',keyId:config.keyId}});
    result={v:1,grade:{revision:grade.revision,latest:grade.latest}};
   }
   else if(p.action==='exchange'&&(Object.keys(p).length===4||(Object.keys(p).length===5&&Object.hasOwn(p,'approval')&&config.admissionReusableBoardEnabled===true&&assistantAdapter.reusableBoardEnabled===true))){
    if(p.payload?.ownerId!==config.ownerId||p.payload?.assistantId!==config.assistantId)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    await validateWork(p.payload);
    if(ready&&!store.get(p.payload.eventId)&&typeof assistantAdapter.registerSignedWork==='function'){
     try{await assistantAdapter.registerSignedWork(p.payload,{ownerId:p.ownerId,keyId:config.keyId},p.approval);}
     catch{throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});}
    }
    // Groq admission is exact administrator-approved scope, never arbitrary text.
    if(pilot&&typeof assistantAdapter.acceptsWorkScope!=='function')throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    const savedScope=store.get(p.payload.eventId)?.state==='completed'&&typeof assistantAdapter.acceptsSavedWorkScope==='function'&&assistantAdapter.acceptsSavedWorkScope(p.payload)===true;
    if(typeof assistantAdapter.acceptsWorkScope==='function'&&!assistantAdapter.acceptsWorkScope(p.payload)&&!savedScope)throw Object.assign(Error('owner_scope_denied'),{code:'owner_scope_denied'});
    // Polling an authenticated existing immutable job never consumes provider capacity.
    // accept() still validates the entire payload and rejects altered replay content.
    if(!ready&&!store.get(p.payload.eventId))throw Object.assign(Error('assistant_invocation_unavailable'),{code:'assistant_invocation_unavailable'});
    const row=await store.accept(p.payload);result={state:row.state,...(row.state==='completed'?{result:JSON.parse(row.result_json)}:{}),...(row.last_error?resultError(row.last_error):{})};
   }else throw new ProtocolError('invalid_request');
   return signedResponse(result,200,nonce,config);
  }catch(error){
   const allowed=['authentication_denied','replayed_request','owner_scope_denied','idempotency_conflict','scope_revoked','scope_expired','assistant_invocation_unavailable','invalid_work','body_too_large','invalid_json','invalid_request','request_invalid','grade_conflict','grade_unavailable','grade_invalid','admission_rate_limited','queue_capacity','relay_draining'];
   const code=allowed.includes(error?.code)?error.code:'relay_unavailable',status=code==='admission_rate_limited'?429:['authentication_denied','owner_scope_denied'].includes(code)?403:['replayed_request','idempotency_conflict','grade_conflict','grade_unavailable'].includes(code)?409:['assistant_invocation_unavailable','relay_unavailable','grade_invalid','queue_capacity','relay_draining'].includes(code)?503:400;
   return nonce?signedResponse({error:code},status,nonce,config):new Response(JSON.stringify({error:code}),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  }
 };
}
