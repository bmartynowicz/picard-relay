import {lstatSync,realpathSync,readdirSync,openSync,readSync,fstatSync,closeSync,constants} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {canonical,validateWork} from './protocol.mjs';
import {createGroqOnceAdapter} from './groq-once-adapter.mjs';
import {createFreeOnlyRoutingAdapter,FREE_ONLY_ROUTING_POLICY} from './selected-assistant.mjs';
import {groqHttpsFetch} from './https-fetch.mjs';
import {AdapterBlockedError,isIncompleteInvocation} from './adapters.mjs';
import {readBoundAdmissionPolicy,locateAdmissionSlot,gateFromCommittedWork} from './admission-policy.mjs';
import {admissionHash} from './admission-store.mjs';
import {validateReusableBoardAttestation} from './admission-plan.mjs';

const blocked=code=>new AdapterBlockedError(code,code);
export function createAdmissionAssistantAdapter({activationEnabled=false,signedBridgeEnabled=false,reusableBoardEnabled=false,workspaceEnabled=false,bridgeKeyId='',loadPolicy,binding,apiKey='',markerDirectory='',now=Date.now,fetchImpl=groqHttpsFetch,priorEnrollmentIds=[],testOnly=null}={}){
 let storage=null,canAccept=()=>false,busy=false;const attempted=new Set(),live=new Map();
 const synthetic=testOnly?.synthetic===true;
 const priorEnrollments=new Set(priorEnrollmentIds);
 const configured=activationEnabled===true&&typeof apiKey==='string'&&apiKey.length>0&&!/[\r\n]/.test(apiKey)&&typeof loadPolicy==='function'&&binding?.assistantId==='groq:openai/gpt-oss-20b'&&admissionHash(apiKey)===binding.keySha256;
 function parentReady(){if(synthetic&&testOnly.markerParentReady)return testOnly.markerParentReady()===true;try{const s=lstatSync(markerDirectory);return isAbsolute(markerDirectory)&&resolve(markerDirectory)===markerDirectory&&realpathSync(markerDirectory)===markerDirectory&&s.isDirectory()&&!s.isSymbolicLink()&&s.uid===process.getuid?.()&&(s.mode&0o777)===0o700;}catch{return false;}}
 function spent(grantId){if(synthetic&&testOnly.markerSpent)return testOnly.markerSpent(grantId)===true;try{const names=readdirSync(markerDirectory);return names.length>1024||names.some(name=>name.includes(grantId));}catch{return true;}}
 function readReservation(name){
  const file=join(markerDirectory,name),before=lstatSync(file);
  if(!before.isFile()||before.nlink!==1||before.size<1||before.size>1024)throw Error('reservation_invalid');
  if(process.platform==='linux'&&(before.uid!==process.getuid()||(before.mode&0o777)!==0o600))throw Error('reservation_invalid');
  const fd=openSync(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
   const bytes=Buffer.alloc(1025),size=readSync(fd,bytes,0,bytes.length,0),after=fstatSync(fd),current=lstatSync(file);
   if(size!==before.size||['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].some(key=>before[key]!==after[key]||before[key]!==current[key]))throw Error('reservation_changed');
   return JSON.parse(bytes.subarray(0,size).toString('utf8'));
  }finally{closeSync(fd);}
 }
 function reservationsReady(){
  try{
   const names=readdirSync(markerDirectory);if(names.length>1024)return false;
   for(const name of names){
    if(name.startsWith('.groq-cost-'))return false;
    if(!name.endsWith('.pending'))continue;
    const match=/^groq-once-([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.consumed\.pending$/.exec(name);
    if(!match||reusableBoardEnabled!==true)return false;
    const record=readReservation(name);
    if(!record||Object.keys(record).sort().join(',')!=='enrollmentId,state,v'||record.v!==1||record.state!=='pending-before-io')return false;
    const retired=record.enrollmentId!==binding.enrollmentId&&priorEnrollments.has(record.enrollmentId);
    if(!storage.pendingGrantAssociated(match[1],record.enrollmentId,retired?()=>readReservation(name.slice(0,-'.pending'.length)):null))return false;
   }
   return true;
  }catch{return false;}
 }
 const policy=()=>readBoundAdmissionPolicy(loadPolicy,binding);
 function availability(){
  if(!configured||!storage||!parentReady())return {acceptingRequests:false,pendingUncertainty:false,costContradiction:true,code:'configuration_unavailable'};
  try{const p=policy(),c=p.catalogue,at=now();
   if((at<c.notBefore||at>=c.expiresAt)&&reusableBoardEnabled!==true)return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'catalogue_expired'};
   if(busy||!canAccept())return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'relay_busy_or_draining'};
   if(!storage.legacyAdmissionReady(c.enrollmentId))return {acceptingRequests:false,pendingUncertainty:false,costContradiction:false,code:'legacy_review_required'};
   const pending=storage.hasEnrollmentUncertainty(c.enrollmentId);
   if(!reservationsReady())return {acceptingRequests:false,pendingUncertainty:true,costContradiction:true,code:'pending_uncertainty'};
   if(pending&&reusableBoardEnabled!==true)return {acceptingRequests:false,pendingUncertainty:true,costContradiction:false,code:'pending_uncertainty'};
   let available=false;
   for(const e of at>=c.notBefore&&at<c.expiresAt?c.entries:[])for(const s of e.slots){const row=storage.get(s.eventId);if(row)approved(s.eventId);if(attempted.has(s.eventId)||spent(s.grantId)||storage.grantSeenElsewhere(s.grantId,s.eventId)||row&&!['queued','claimed'].includes(row.state))continue;
    const issued=row?Date.parse(JSON.parse(row.payload_json).request.createdAt):at,expires=row?row.grant_expires:Math.min(at+c.maxRequestLifetimeMs,c.expiresAt);
    const gate={v:3,purpose:e.purpose,provider:'groq',model:p.costEnrollment.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:c.ownerId,task:c.taskId,grantId:s.grantId,eventId:s.eventId,approvedRequestText:e.requestText,taskContext:e.taskContext,approvedInputSha256:e.inputSha256,enrollmentId:c.enrollmentId,costEnrollment:p.costEnrollment,requestIssuedAt:issued,requestExpiresAt:expires};
    const probe=makeAdapter(gate,s,reusableBoardEnabled===true);if(probe.ready===true)available=true;
   }
   if(reusableBoardEnabled===true){const text='Readiness probe only',context={title:'Readiness probe',nextAction:'',latestFinding:''},slot={grantId:'00000000-0000-4000-8000-000000000000',eventId:'0'.repeat(64)},gate={v:3,purpose:'sanitized-source-proposal',provider:'groq',model:p.costEnrollment.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:c.ownerId,task:c.taskId,grantId:slot.grantId,eventId:slot.eventId,approvedRequestText:text,taskContext:context,approvedInputSha256:admissionHash(canonical({requestText:text,taskContext:context})),enrollmentId:c.enrollmentId,costEnrollment:p.costEnrollment,requestIssuedAt:at,requestExpiresAt:at+60000};if(makeAdapter(gate,slot,true).ready===true)available=true;}
   return {acceptingRequests:available,pendingUncertainty:pending,isolatedFailures:reusableBoardEnabled===true,costContradiction:false,code:available?'ready':'allowance_unavailable'};
  }catch{return {acceptingRequests:false,pendingUncertainty:false,costContradiction:true,code:'catalogue_unavailable'};}
 }
 function makeAdapter(gate,slot,perGrantCostLatch=false){
  const options={enabled:true,apiKey,gate,markerPath:join(markerDirectory,'groq-once-'+slot.grantId+'.consumed'),fetchImpl,now,timeoutMs:30000,perGrantCostLatch};
  return createFreeOnlyRoutingAdapter(synthetic&&testOnly.adapterFactory?testOnly.adapterFactory(options):createGroqOnceAdapter(options));
 }
 function approved(eventId){
  if(!configured||!storage)throw blocked('groq_free_scope_unavailable');
  if(reusableBoardEnabled===true){const saved=(workspaceEnabled===true?storage.getWorkspaceWork(eventId):null)??storage.getReusableBoard(eventId);if(saved){const p=policy(),{row,payload,approval:a}=saved,c=p.catalogue,slot={eventId:payload.eventId,grantId:payload.grantId,requestId:payload.requestId},gate={v:3,purpose:a.purpose,provider:'groq',model:p.costEnrollment.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:payload.ownerId,task:payload.taskId,grantId:payload.grantId,eventId:payload.eventId,approvedRequestText:payload.request.text,taskContext:payload.context,approvedInputSha256:a.inputSha256,enrollmentId:c.enrollmentId,costEnrollment:p.costEnrollment,requestIssuedAt:a.issuedAt,requestExpiresAt:a.expiresAt,...(a.maxCompletionTokens===4096?{maxCompletionTokens:4096}:{})};if(storage.grantSeenElsewhere(slot.grantId,eventId))throw blocked('groq_scope_mismatch');return {p,slot,row,payload,gate,reusable:true};}}
  const p=policy(),found=locateAdmissionSlot(p,eventId),row=storage.get(eventId);if(!found||!row||!storage.isApproved({catalogue:p.catalogue,...found,catalogueSha256:p.catalogueSha256})||storage.grantSeenElsewhere(found.slot.grantId,eventId))throw blocked('groq_scope_mismatch');
  const payload=JSON.parse(row.payload_json),gate=gateFromCommittedWork(p,found.entry,found.slot,payload,{allowShorterLifetime:signedBridgeEnabled===true});if(row.owner!==payload.ownerId||row.task!==payload.taskId||row.message_id!==payload.requestId||row.grant_id!==payload.grantId||row.payload_hash!==payload.payloadHash||row.grant_expires!==payload.grantExpiresAt)throw blocked('groq_scope_mismatch');return {p,...found,row,payload,gate};
 }
 return Object.freeze({kind:activationEnabled===true?'groq-finite-admission':'groq-finite-admission-disabled',assistantId:'groq:openai/gpt-oss-20b',localTestOnly:synthetic,routingPolicy:FREE_ONLY_ROUTING_POLICY,reusableBoardEnabled:reusableBoardEnabled===true,
  permitsBoardTask({ownerId,taskId,action}){return reusableBoardEnabled===true&&ownerId===binding?.ownerId&&typeof taskId==='string'&&taskId.length>0&&taskId.length<=200&&['exchange','result','cancel','grade','grade_status'].includes(action);},
  get ready(){return availability().acceptingRequests;},get canServeResults(){return configured&&parentReady();},availability,
  attachStore(store,{accepting=()=>true}={}){if(storage)throw blocked('groq_scope_mismatch');storage=store;canAccept=accepting;},
  async registerSignedWork(payload,identity,approval){
   if(signedBridgeEnabled!==true||!configured||!storage||!bridgeKeyId||identity?.ownerId!==binding.ownerId||identity?.keyId!==bridgeKeyId)throw blocked('groq_scope_mismatch');
   if(approval!==undefined){if(reusableBoardEnabled!==true)throw blocked('groq_scope_mismatch');await validateReusableBoardAttestation({payload,approval,ownerId:binding.ownerId,enrollmentId:binding.enrollmentId,at:now()});const p=policy();if(attempted.has(payload.eventId)||spent(payload.grantId))throw blocked('groq_free_scope_unavailable');storage.recordAttempt(admissionHash(canonical([binding.ownerId,'reusable-board'])));return storage.commitReusableBoard({payload,approval,currentAvailability:availability,revalidate:()=>policy().catalogueSha256===p.catalogueSha256&&!attempted.has(payload.eventId)&&!spent(payload.grantId)});}
   await validateWork(payload);const p=policy(),found=locateAdmissionSlot(p,payload.eventId);if(!found)throw blocked('groq_scope_mismatch');
   gateFromCommittedWork(p,found.entry,found.slot,payload,{allowShorterLifetime:true});
   if(!storage.get(payload.eventId)&&(attempted.has(payload.eventId)||spent(found.slot.grantId)))throw blocked('groq_free_scope_unavailable');
   storage.recordAttempt(admissionHash(canonical([binding.ownerId,binding.taskId])));
   return storage.commitSignedBridge({payload,catalogue:p.catalogue,selection:{entryId:found.entry.entryId,slotId:found.slot.slotId},catalogueSha256:p.catalogueSha256,currentAvailability:availability,revalidate:()=>policy().catalogueSha256===p.catalogueSha256&&!attempted.has(payload.eventId)&&!spent(found.slot.grantId)});
  },
  acceptsWorkScope(payload){try{const a=approved(payload?.eventId);return a.row.payload_json===canonical(payload);}catch{return false;}},
  // Read permission does not register, claim, renew or invoke historical work.
  acceptsSavedWorkScope(payload){try{const saved=storage?.readHistoricalWork(payload?.eventId);return !!saved&&saved.row.state==='completed'&&saved.row.payload_json===canonical(payload);}catch{return false;}},
  claimNext(input){
   if(!configured||!storage)return null;
   try{const p=policy(),old=p.catalogue.entries.flatMap(e=>e.slots.map(s=>s.eventId)).filter(id=>{const r=storage.get(id);return r&&['queued','claimed','invoking'].includes(r.state);}),ids=[...new Set([...old,...(reusableBoardEnabled===true?storage.listReusableBoard():[])])];if(ids.length>8)return null;storage.reconcileEligible(ids);const mayInvoke=availability().acceptingRequests;const eligible=ids.filter(id=>{try{const a=approved(id),saved=a.row.response_id&&a.row.result_json&&a.row.state==='invoking'&&a.row.claimed_until<=now()&&a.row.grant_expires>now();return !!saved||mayInvoke&&!spent(a.slot.grantId)&&!attempted.has(id);}catch{return false;}});return storage.claimEligible({...input,ids:eligible});}catch{return null;}
  },
  async answer(input){
   if(busy||!parentReady()||!reservationsReady())throw blocked('groq_free_scope_unavailable');
   const a=approved(input.requestId);
   if(attempted.has(input.requestId)||a.row.state!=='invoking'||a.row.attempt!==input.attempt||a.row.claimed_until<=now()||input.owner!==a.row.owner||input.task!==a.row.task||input.invocationId!==a.row.event_id)throw blocked('groq_scope_mismatch');
   const at=now(),pending=storage.hasEnrollmentUncertainty(a.p.catalogue.enrollmentId,{excludeInvokingEventId:input.requestId});
   if(!canAccept()||(pending&&reusableBoardEnabled!==true)||(!a.reusable&&(at<a.p.catalogue.notBefore||at>=a.p.catalogue.expiresAt))||policy().catalogueSha256!==a.p.catalogueSha256)throw blocked('groq_free_scope_unavailable');
   const adapter=makeAdapter(a.gate,a.slot,reusableBoardEnabled===true);if(adapter.ready!==true)throw blocked('groq_free_scope_unavailable');
   attempted.add(input.requestId);busy=true;live.set(input.requestId,adapter);
   try{const result=await adapter.answer(input);live.delete(input.requestId);return result;}catch(e){if(!isIncompleteInvocation(e))live.delete(input.requestId);throw e;}finally{busy=false;}
  },
  async finalizeIncomplete(input){const adapter=live.get(input?.requestId);if(!adapter)throw blocked('groq_cost_enrollment_stopped');const result=await adapter.finalizeIncomplete(input);live.delete(input.requestId);return result;},
 });
}
