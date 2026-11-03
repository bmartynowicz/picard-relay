// Operator-side protocol client. No gate creation, provider keys, runtime selection,
// retries, tool execution or new server endpoint. Not part of the11-file updater.
import {canonical,digest,payloadHash,signRequest,verifyResponse,validateWork} from '../experimental/runtime-control/src/protocol.mjs';
const STATES=new Set(['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain']);
const CODES=new Set(['scope_expired','scope_revoked','assistant_invocation_unavailable','owner_scope_denied','authentication_denied','invalid_work','invalid_request','queue_capacity','relay_draining','groq_output_incomplete','groq_outcome_uncertain','invocation_outcome_uncertain','groq_payment_required','groq_quota_exhausted','groq_request_rejected']);
export class ManualClientError extends Error{constructor(code){super(code);this.code=code;}}
const deny=code=>{throw new ManualClientError(code);};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validCostEnrollmentMetadata(e){
 const fields=['v','provider','model','owner','accountLabel','organizationId','projectId','keySha256','accountPlan','noPaidFallback','verifiedAt','enrolledAt','evidenceRef','keyAssociationEvidenceRef'];
 return exact(e,fields)&&e.v===1&&e.provider==='groq'&&e.model==='openai/gpt-oss-20b'&&e.accountPlan==='Free'&&e.noPaidFallback===true&&['owner','accountLabel','organizationId','projectId','evidenceRef','keyAssociationEvidenceRef'].every(k=>typeof e[k]==='string'&&e[k].trim().length>0&&e[k].length<=500)&&/^[a-f0-9]{64}$/.test(e.keySha256)&&Number.isSafeInteger(e.verifiedAt)&&e.verifiedAt>=0&&Number.isSafeInteger(e.enrolledAt)&&e.enrolledAt>=e.verifiedAt;
}
function snapshotIntent(value){if(!exact(value,['v','payload']))deny('intent_invalid');try{return JSON.parse(JSON.stringify(value));}catch{deny('intent_invalid');}}
function target(origin){let u;try{u=new URL(origin);}catch{deny('configuration_unavailable');}if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash||u.origin!==origin)deny('configuration_unavailable');return u.origin+'/bridge/v1';}
export async function createManualIntent({gate,requestId}){
 if(!object(gate)||gate.v!==3||typeof requestId!=='string'||!requestId||requestId.length>200)deny('intent_invalid');
 const payload={v:1,eventId:await digest(canonical([gate.owner,gate.task,requestId])),ownerId:gate.owner,taskId:gate.task,requestId,grantId:gate.grantId,assistantId:'groq:openai/gpt-oss-20b',grantExpiresAt:gate.requestExpiresAt,request:{text:gate.approvedRequestText,createdAt:new Date(gate.requestIssuedAt).toISOString(),answerTo:null},context:gate.taskContext};payload.payloadHash=await payloadHash(payload);await validateWork(payload);return {v:1,payload};
}
export async function validateManualIntent(intent,config,{requireActiveGate=true,now=Date.now()}={}){
 if(!exact(intent,['v','payload'])||intent.v!==1)deny('intent_invalid');
 try{await validateWork(intent.payload);}catch{deny('intent_invalid');}
 const p=intent.payload;
 if(p.ownerId!==config.ownerId||p.taskId!==config.allowedTaskId||p.assistantId!=='groq:openai/gpt-oss-20b'||config.assistantId!==p.assistantId)deny('identity_mismatch');
 target(config.origin);
 if(!requireActiveGate)return p;
 const g=config.gate,e=g?.costEnrollment;
 if(!object(g)||g.v!==3||!['public-source-review','sanitized-source-proposal'].includes(g.purpose)||g.provider!=='groq'||g.model!=='openai/gpt-oss-20b'||g.maxCalls!==1||g.harmlessTestOnly!==true||g.accountPlan!=='Free'||g.noPaidFallback!==true||!validCostEnrollmentMetadata(e)||e.owner!==g.owner||e.enrolledAt>g.requestIssuedAt||await digest(canonical(e))!==g.enrollmentId||new TextEncoder().encode(JSON.stringify({request:p.request.text,context:p.context})).length>12000)deny('active_gate_mismatch');
 if(g.owner!==p.ownerId||g.task!==p.taskId||g.eventId!==p.eventId||g.grantId!==p.grantId||g.requestExpiresAt!==p.grantExpiresAt||Date.parse(p.request.createdAt)!==g.requestIssuedAt||p.request.answerTo!==null||g.approvedRequestText!==p.request.text||canonical(g.taskContext)!==canonical(p.context)||await digest(canonical({requestText:p.request.text,taskContext:p.context}))!==g.approvedInputSha256)deny('active_gate_mismatch');
 if(!Number.isSafeInteger(g.requestIssuedAt)||!Number.isSafeInteger(g.requestExpiresAt)||g.requestIssuedAt>now||g.requestExpiresAt<=now||g.requestExpiresAt-g.requestIssuedAt>3600000||g.requestExpiresAt<=g.requestIssuedAt)deny('scope_expired');
 return p;
}
function project(value,p){
 if(!object(value))deny('response_invalid');
 if(typeof value.error==='string')return {state:'blocked',code:CODES.has(value.error)?value.error:'remote_rejected'};
 if(!STATES.has(value.state))deny('response_invalid');
 const out={state:value.state};if(typeof value.code==='string')out.code=CODES.has(value.code)?value.code:'recorded_failure';
 if(value.state==='completed'){
  const r=value.result;
  if(!object(r)||r.v!==1||r.ownerId!==p.ownerId||r.taskId!==p.taskId||r.requestId!==p.requestId||r.grantId!==p.grantId||r.eventId!==p.eventId||r.payloadHash!==p.payloadHash||r.assistantId!==p.assistantId||r.responseId!=='resp:'+p.eventId||typeof r.body!=='string'||!r.body.trim()||r.body.length>4000||!object(r.outcome)||!['information','question'].includes(r.outcome.kind))deny('response_invalid');
  out.responseId=r.responseId;out.result={body:r.body,kind:r.outcome.kind};
 }
 return out;
}
export function createManualClient({config,transport,journal,now=Date.now}){
 try{config=JSON.parse(JSON.stringify(config));}catch{deny('configuration_unavailable');}
 if(typeof transport!=='function'||typeof journal?.load!=='function'||typeof journal?.reserve!=='function'||typeof journal?.record!=='function')deny('configuration_unavailable');
 const url=target(config.origin);
 async function post(body,p,{signal}={}){
  let signed,response,value;
  try{if(signal?.aborted)deny('result_wait_expired');signed=await signRequest(url,body,config,now());if(signal?.aborted)deny('result_wait_expired');response=await transport(signal?new Request(signed.request,{signal}):signed.request);if(response.status>=300&&response.status<400){await response.body?.cancel();deny('redirect_rejected');}value=await verifyResponse(response,signed.nonce,config);}catch(error){if(signal?.aborted)deny('result_wait_expired');if(error instanceof ManualClientError)throw error;deny('response_unconfirmed');}
  const projected=project(value,p);if(response.status!==200&&projected.state!=='blocked')deny('response_invalid');return {...projected,httpStatus:response.status,responseAuthenticated:true};
 }
 async function result(intent,options={}){intent=snapshotIntent(intent);const p=await validateManualIntent(intent,config,{requireActiveGate:false,now:now()});return post({v:1,action:'result',ownerId:p.ownerId,taskId:p.taskId,eventId:p.eventId,payloadHash:p.payloadHash},p,options);}
 async function submit(intent){
  intent=snapshotIntent(intent);
  // Reservation is durable and atomic BEFORE any work submission. A previous
  // intent permits only result retrieval, even if its last response was lost.
  const p=await validateManualIntent(intent,config,{requireActiveGate:false,now:now()});
  let prior;try{prior=await journal.load(p.eventId);}catch{deny('journal_unavailable');}
  if(prior){if(prior.payloadHash!==p.payloadHash)deny('intent_conflict');return {...await result(intent),submission:'not_repeated'};}
  await validateManualIntent(intent,config,{requireActiveGate:true,now:now()});
  let reservation;try{reservation=await journal.reserve(intent);}catch{deny('journal_unavailable');}
  if(reservation?.payloadHash!==p.payloadHash)deny('intent_conflict');
  if(reservation.created!==true)return {...await result(intent),submission:'not_repeated'};
  let receipt;
  try{receipt=await post({v:1,action:'exchange',ownerId:p.ownerId,payload:p},p);}catch(error){try{await journal.record(p.eventId,{state:'submission_unconfirmed'});}catch{}throw error;}
  try{await journal.record(p.eventId,{state:receipt.state,httpStatus:receipt.httpStatus});}catch{deny('journal_unavailable');}
  return {...receipt,submission:'sent_once'};
 }
 return Object.freeze({submit,result});
}
