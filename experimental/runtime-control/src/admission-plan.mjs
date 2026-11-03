// Pure bounded planning: no file I/O or network. Caller authentication and
// durable one-use approval are enforced separately by admission-handler/store.
import {canonical,digest,payloadHash,validateWork} from './protocol.mjs';
import {createHash} from 'node:crypto';
import {validCostEnrollmentMetadata} from './admission-enrollment.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const slug=v=>typeof v==='string'&&/^[a-z0-9-]{1,50}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stop=code=>{throw Object.assign(new Error(code),{code});};

// The caller must first verify the HMAC over the entire exchange, and the
// trusted Board must have revalidated its durable owner-approved grant. This
// function checks binding only; the object alone is not authorization.
export async function validateReusableBoardAttestation({payload,approval,ownerId,enrollmentId,at}={}){
 if(!exact(approval,['v','purpose','enrollmentId','inputSha256','issuedAt','expiresAt'])||approval.v!==1||!['public-source-review','sanitized-source-proposal'].includes(approval.purpose)||!hex(enrollmentId)||approval.enrollmentId!==enrollmentId||!hex(approval.inputSha256)||!integer(approval.issuedAt)||!integer(approval.expiresAt)||!integer(at)||approval.issuedAt>at||approval.expiresAt<=at||approval.expiresAt-approval.issuedAt<1000||approval.expiresAt-approval.issuedAt>3600000)stop('approval_invalid');
 try{await validateWork(payload);}catch{stop('work_invalid');}
 const created=Date.parse(payload.request.createdAt),inputSha256=hash(canonical({requestText:payload.request.text,taskContext:payload.context}));
 if(payload.ownerId!==ownerId||payload.assistantId!=='groq:openai/gpt-oss-20b'||payload.request.answerTo!==null||created<approval.issuedAt||created>at||payload.grantExpiresAt!==approval.expiresAt||inputSha256!==approval.inputSha256)stop('scope_mismatch');
 return {purpose:approval.purpose,enrollmentId,inputSha256,issuedAt:approval.issuedAt,expiresAt:approval.expiresAt};
}

// Local design fixture only. A production caller must authenticate the Board,
// establish owner approval independently, and persist consumption atomically.
// An object passed as `actor` is a test precondition, not an auth credential.
export async function planReusableBoardApproval({mode,ownerId,enrollmentId,actor,grant,payload,at,seenGrantIds=[],seenEventIds=[]}={}){
 if(mode!=='synthetic-review-only')stop('production_admission_not_implemented');
 if(!text(ownerId,200)||!hex(enrollmentId)||!exact(actor,['ownerId','approvedInputSha256','approvedAt'])||actor.ownerId!==ownerId||!integer(actor.approvedAt)||!integer(at)||actor.approvedAt>at||at-actor.approvedAt>60000)stop('owner_approval_required');
 if(!exact(grant,['ownerId','taskId','requestId','grantId','eventId','inputSha256','enrollmentId','issuedAt','expiresAt'])||grant.ownerId!==ownerId||grant.enrollmentId!==enrollmentId||!text(grant.taskId,200)||!uuid(grant.requestId)||!uuid(grant.grantId)||!hex(grant.eventId)||!hex(grant.inputSha256)||!integer(grant.issuedAt)||!integer(grant.expiresAt)||grant.issuedAt>at||grant.expiresAt<=at||grant.expiresAt-grant.issuedAt<1000||grant.expiresAt-grant.issuedAt>3600000)stop('grant_invalid');
 if(!Array.isArray(seenGrantIds)||!Array.isArray(seenEventIds)||seenGrantIds.includes(grant.grantId)||seenEventIds.includes(grant.eventId))stop('grant_spent');
 try{await validateWork(payload);}catch{stop('work_invalid');}
 const inputSha256=hash(canonical({requestText:payload.request.text,taskContext:payload.context}));
 if(actor.approvedInputSha256!==inputSha256||grant.inputSha256!==inputSha256||payload.ownerId!==ownerId||payload.taskId!==grant.taskId||payload.requestId!==grant.requestId||payload.grantId!==grant.grantId||payload.eventId!==grant.eventId||Date.parse(payload.request.createdAt)!==grant.issuedAt||payload.grantExpiresAt!==grant.expiresAt||hash(canonical([ownerId,grant.taskId,grant.requestId]))!==grant.eventId)stop('scope_mismatch');
 return {kind:'synthetic_reusable_approval_only',mayInvoke:false,ownerId,taskId:grant.taskId,eventId:grant.eventId,inputSha256,enrollmentId};
}
export function validateCatalogueSync(c){
 if(!exact(c,['v','kind','ownerId','taskId','assistantId','enrollmentId','notBefore','expiresAt','maxRequestLifetimeMs','entries'])||c.v!==1||c.kind!=='FINITE_ADMISSION_PROTOTYPE_ONLY'||!text(c.ownerId,200)||!text(c.taskId,200)||c.assistantId!=='groq:openai/gpt-oss-20b'||!hex(c.enrollmentId)||!integer(c.notBefore)||!integer(c.expiresAt)||c.expiresAt<=c.notBefore||c.expiresAt-c.notBefore>86400000||!integer(c.maxRequestLifetimeMs)||c.maxRequestLifetimeMs<1000||c.maxRequestLifetimeMs>3600000||!Array.isArray(c.entries)||c.entries.length>8||new TextEncoder().encode(canonical(c)).length>16384)stop('catalogue_invalid');
 const entryIds=new Set(),requests=new Set(),grants=new Set(),events=new Set();let total=0;
 for(const e of c.entries){
  if(!exact(e,['entryId','purpose','requestText','taskContext','inputSha256','slots'])||!slug(e.entryId)||entryIds.has(e.entryId)||!['public-source-review','sanitized-source-proposal'].includes(e.purpose)||!text(e.requestText,4000)||!exact(e.taskContext,['title','nextAction','latestFinding'])||!text(e.taskContext.title,200)||typeof e.taskContext.nextAction!=='string'||e.taskContext.nextAction.length>1500||typeof e.taskContext.latestFinding!=='string'||e.taskContext.latestFinding.length>4000||!hex(e.inputSha256)||hash(canonical({requestText:e.requestText,taskContext:e.taskContext}))!==e.inputSha256||new TextEncoder().encode(JSON.stringify({request:e.requestText,context:e.taskContext})).length>12000||!Array.isArray(e.slots)||!e.slots.length)stop('catalogue_entry_invalid');entryIds.add(e.entryId);const slots=new Set();
  for(const s of e.slots){if(!exact(s,['slotId','requestId','grantId','eventId'])||!slug(s.slotId)||slots.has(s.slotId)||!uuid(s.requestId)||!uuid(s.grantId)||!hex(s.eventId)||hash(canonical([c.ownerId,c.taskId,s.requestId]))!==s.eventId||requests.has(s.requestId)||grants.has(s.grantId)||events.has(s.eventId)||++total>8)stop('catalogue_slot_invalid');slots.add(s.slotId);requests.add(s.requestId);grants.add(s.grantId);events.add(s.eventId);}
 }
 return {entryCount:c.entries.length,slotCount:total,catalogueSha256:hash(canonical(c))};
}
export async function validateCatalogue(c){return validateCatalogueSync(c);}
export async function planFiniteAdmission({mode,catalogue,costEnrollment,actor,selection,at,existingPayload=null}={}){
 if(mode!=='synthetic-review-only')stop('production_admission_not_implemented');
 const c=JSON.parse(JSON.stringify(catalogue));
 costEnrollment=JSON.parse(JSON.stringify(costEnrollment));
 actor=actor&&JSON.parse(JSON.stringify(actor));selection=selection&&JSON.parse(JSON.stringify(selection));
 existingPayload=existingPayload&&JSON.parse(JSON.stringify(existingPayload));
 const info=await validateCatalogue(c);
 // actor is a TRUSTED-CALLER PRECONDITION in this pure fixture. This object is
 // not an authentication proof. The runtime handler establishes it only after
 // existing owner authentication and session-bound nonce verification.
 if(!exact(actor,['ownerId','approvedInputSha256','approvedAt','approvalRef'])||actor.ownerId!==c.ownerId||!text(actor.approvalRef,200)||!integer(actor.approvedAt)||!integer(at)||actor.approvedAt>at||at-actor.approvedAt>60000)stop('owner_approval_required');
 if(!exact(selection,['entryId','slotId'])||!slug(selection.entryId)||!slug(selection.slotId))stop('selection_invalid');
 const entry=c.entries.find(e=>e.entryId===selection.entryId),slot=entry?.slots.find(s=>s.slotId===selection.slotId);if(!entry||!slot)stop('selection_unavailable');if(actor.approvedInputSha256!==entry.inputSha256)stop('approval_input_changed');
 const e=costEnrollment;if(!validCostEnrollmentMetadata(e)||e.owner!==c.ownerId||e.enrolledAt>c.notBefore||await digest(canonical(e))!==c.enrollmentId)stop('enrollment_mismatch');
 const matches=p=>p.ownerId===c.ownerId&&p.taskId===c.taskId&&p.assistantId===c.assistantId&&p.eventId===slot.eventId&&p.requestId===slot.requestId&&p.grantId===slot.grantId&&p.request.text===entry.requestText&&p.request.answerTo===null&&canonical(p.context)===canonical(entry.taskContext);
 if(existingPayload){try{await validateWork(existingPayload);}catch{stop('existing_record_invalid');}const issued=Date.parse(existingPayload.request.createdAt),life=existingPayload.grantExpiresAt-issued;if(!matches(existingPayload)||issued<c.notBefore||issued>=c.expiresAt||issued>at||existingPayload.grantExpiresAt>c.expiresAt||life<1000||life>c.maxRequestLifetimeMs)stop('existing_record_mismatch');return {kind:'existing_record_only',mayInvoke:false,intent:{v:1,payload:JSON.parse(JSON.stringify(existingPayload))},...info};}
 if(at<c.notBefore||at>=c.expiresAt)stop('catalogue_expired');
 const expires=Math.min(at+c.maxRequestLifetimeMs,c.expiresAt);if(expires-at<1000)stop('catalogue_expired');
 const p={v:1,eventId:slot.eventId,ownerId:c.ownerId,taskId:c.taskId,requestId:slot.requestId,grantId:slot.grantId,assistantId:c.assistantId,grantExpiresAt:expires,request:{text:entry.requestText,createdAt:new Date(at).toISOString(),answerTo:null},context:entry.taskContext};p.payloadHash=await payloadHash(p);await validateWork(p);
 const gate={v:3,purpose:entry.purpose,provider:'groq',model:'openai/gpt-oss-20b',accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:c.ownerId,task:c.taskId,grantId:slot.grantId,eventId:slot.eventId,approvedRequestText:entry.requestText,taskContext:entry.taskContext,approvedInputSha256:entry.inputSha256,enrollmentId:c.enrollmentId,costEnrollment:JSON.parse(JSON.stringify(e)),requestIssuedAt:at,requestExpiresAt:expires};
 return {kind:'synthetic_plan_only',mayInvoke:false,intent:{v:1,payload:p},gate,policy:{maxCalls:1,maxOutputTokens:512,tools:false,retries:0,paidFallback:false},...info};
}
