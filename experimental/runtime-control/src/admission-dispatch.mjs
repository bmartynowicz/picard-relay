import {lstatSync,realpathSync,readdirSync} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {canonical} from './protocol.mjs';
import {createGroqOnceAdapter} from './groq-once-adapter.mjs';
import {createFreeOnlyRoutingAdapter,FREE_ONLY_ROUTING_POLICY} from './selected-assistant.mjs';
import {groqHttpsFetch} from './https-fetch.mjs';
import {AdapterBlockedError,isIncompleteInvocation} from './adapters.mjs';
import {readBoundAdmissionPolicy,locateAdmissionSlot,gateFromCommittedWork} from './admission-policy.mjs';
import {admissionHash} from './admission-store.mjs';

const blocked=code=>new AdapterBlockedError(code,code);
export function createAdmissionAssistantAdapter({activationEnabled=false,loadPolicy,binding,apiKey='',markerDirectory='',now=Date.now,fetchImpl=groqHttpsFetch,testOnly=null}={}){
 let storage=null,canAccept=()=>false,busy=false;const attempted=new Set(),live=new Map();
 const synthetic=testOnly?.synthetic===true;
 const configured=activationEnabled===true&&typeof apiKey==='string'&&apiKey.length>0&&!/[\r\n]/.test(apiKey)&&typeof loadPolicy==='function'&&binding?.assistantId==='groq:openai/gpt-oss-20b'&&admissionHash(apiKey)===binding.keySha256;
 function parentReady(){if(synthetic&&testOnly.markerParentReady)return testOnly.markerParentReady()===true;try{const s=lstatSync(markerDirectory);return isAbsolute(markerDirectory)&&resolve(markerDirectory)===markerDirectory&&realpathSync(markerDirectory)===markerDirectory&&s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o700;}catch{return false;}}
 function spent(grantId){if(synthetic&&testOnly.markerSpent)return testOnly.markerSpent(grantId)===true;try{const names=readdirSync(markerDirectory);return names.length>1024||names.some(name=>name.includes(grantId));}catch{return true;}}
 const policy=()=>readBoundAdmissionPolicy(loadPolicy,binding);
 function availability(){
  if(!configured||!storage||!parentReady())return {acceptingRequests:false,pendingUncertainty:false,costContradiction:true,code:'configuration_unavailable'};
  try{const p=policy(),c=p.catalogue,at=now();
   if(at<c.notBefore||at>=c.expiresAt)return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'catalogue_expired'};
   if(busy||!canAccept())return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'relay_busy_or_draining'};
   if(!storage.legacyAdmissionReady(c.enrollmentId))return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'legacy_review_required'};
   const pending=storage.hasEnrollmentUncertainty(c.enrollmentId);
   if(pending)return {acceptingRequests:false,pendingUncertainty:true,costContradiction:false,code:'pending_uncertainty'};
   let available=false;
   for(const e of c.entries)for(const s of e.slots){const row=storage.get(s.eventId);if(row)approved(s.eventId);if(attempted.has(s.eventId)||spent(s.grantId)||storage.grantSeenElsewhere(s.grantId,s.eventId)||row&&!['queued','claimed'].includes(row.state))continue;
    const issued=row?Date.parse(JSON.parse(row.payload_json).request.createdAt):at,expires=row?row.grant_expires:Math.min(at+c.maxRequestLifetimeMs,c.expiresAt);
    const gate={v:3,purpose:e.purpose,provider:'groq',model:p.costEnrollment.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:c.ownerId,task:c.taskId,grantId:s.grantId,eventId:s.eventId,approvedRequestText:e.requestText,taskContext:e.taskContext,approvedInputSha256:e.inputSha256,enrollmentId:c.enrollmentId,costEnrollment:p.costEnrollment,requestIssuedAt:issued,requestExpiresAt:expires};
    const probe=makeAdapter(gate,s);if(probe.ready===true)available=true;
   }
   return {acceptingRequests:available,pendingUncertainty:false,costContradiction:false,code:available?'ready':'allowance_unavailable'};
  }catch{return {acceptingRequests:false,pendingUncertainty:false,costContradiction:true,code:'catalogue_unavailable'};}
 }
 function makeAdapter(gate,slot){
  const options={enabled:true,apiKey,gate,markerPath:join(markerDirectory,'groq-once-'+slot.grantId+'.consumed'),fetchImpl,now,timeoutMs:30000};
  return createFreeOnlyRoutingAdapter(synthetic&&testOnly.adapterFactory?testOnly.adapterFactory(options):createGroqOnceAdapter(options));
 }
 function approved(eventId){
  if(!configured||!storage)throw blocked('groq_free_scope_unavailable');
  const p=policy(),found=locateAdmissionSlot(p,eventId),row=storage.get(eventId);if(!found||!row||!storage.isApproved({catalogue:p.catalogue,...found,catalogueSha256:p.catalogueSha256})||storage.grantSeenElsewhere(found.slot.grantId,eventId))throw blocked('groq_scope_mismatch');
  const payload=JSON.parse(row.payload_json),gate=gateFromCommittedWork(p,found.entry,found.slot,payload);if(row.owner!==payload.ownerId||row.task!==payload.taskId||row.message_id!==payload.requestId||row.grant_id!==payload.grantId||row.payload_hash!==payload.payloadHash||row.grant_expires!==payload.grantExpiresAt)throw blocked('groq_scope_mismatch');return {p,...found,row,payload,gate};
 }
 return Object.freeze({kind:activationEnabled===true?'groq-finite-admission':'groq-finite-admission-disabled',assistantId:'groq:openai/gpt-oss-20b',localTestOnly:synthetic,routingPolicy:FREE_ONLY_ROUTING_POLICY,
  get ready(){return availability().acceptingRequests;},get canServeResults(){return configured&&parentReady();},availability,
  attachStore(store,{accepting=()=>true}={}){if(storage)throw blocked('groq_scope_mismatch');storage=store;canAccept=accepting;},
  acceptsWorkScope(payload){try{const a=approved(payload?.eventId);return a.row.payload_json===canonical(payload);}catch{return false;}},
  claimNext(input){
   if(!configured||!storage)return null;
   try{const p=policy(),ids=p.catalogue.entries.flatMap(e=>e.slots.map(s=>s.eventId));storage.reconcileEligible(ids);const mayInvoke=availability().acceptingRequests;const eligible=ids.filter(id=>{try{const a=approved(id),saved=a.row.response_id&&a.row.result_json&&a.row.state==='invoking'&&a.row.claimed_until<=now()&&a.row.grant_expires>now();return !!saved||mayInvoke&&!spent(a.slot.grantId)&&!attempted.has(id);}catch{return false;}});return storage.claimEligible({...input,ids:eligible});}catch{return null;}
  },
  async answer(input){
   if(busy||!parentReady())throw blocked('groq_free_scope_unavailable');
   const a=approved(input.requestId);
   if(attempted.has(input.requestId)||a.row.state!=='invoking'||a.row.attempt!==input.attempt||a.row.claimed_until<=now()||input.owner!==a.row.owner||input.task!==a.row.task||input.invocationId!==a.row.event_id)throw blocked('groq_scope_mismatch');
   const at=now(),pending=storage.hasEnrollmentUncertainty(a.p.catalogue.enrollmentId,{excludeInvokingEventId:input.requestId});
   if(!canAccept()||pending||at<a.p.catalogue.notBefore||at>=a.p.catalogue.expiresAt||policy().catalogueSha256!==a.p.catalogueSha256)throw blocked('groq_free_scope_unavailable');
   const adapter=makeAdapter(a.gate,a.slot);if(adapter.ready!==true)throw blocked('groq_free_scope_unavailable');
   attempted.add(input.requestId);busy=true;live.set(input.requestId,adapter);
   try{const result=await adapter.answer(input);live.delete(input.requestId);return result;}catch(e){if(!isIncompleteInvocation(e))live.delete(input.requestId);throw e;}finally{busy=false;}
  },
  async finalizeIncomplete(input){const adapter=live.get(input?.requestId);if(!adapter)throw blocked('groq_cost_enrollment_stopped');const result=await adapter.finalizeIncomplete(input);live.delete(input.requestId);return result;},
 });
}
