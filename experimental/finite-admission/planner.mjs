// NON-PRODUCTION prototype. Pure plans only: no auth implementation, file I/O,
// network, provider, server route, gate installation or runtime selector export.
import {canonical,digest,payloadHash,validateWork} from '../runtime-control/src/protocol.mjs';
import {validCostEnrollmentMetadata} from '../../tools/manual-client.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const text=(v,max)=>typeof v==='string'&&v.length>0&&v.length<=max;
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const slug=v=>typeof v==='string'&&/^[a-z0-9-]{1,50}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const stop=code=>{throw Object.assign(new Error(code),{code});};
export async function validateCatalogue(c){
 if(!exact(c,['v','kind','ownerId','taskId','assistantId','enrollmentId','notBefore','expiresAt','maxRequestLifetimeMs','entries'])||c.v!==1||c.kind!=='FINITE_ADMISSION_PROTOTYPE_ONLY'||!text(c.ownerId,200)||!text(c.taskId,200)||c.assistantId!=='groq:openai/gpt-oss-20b'||!hex(c.enrollmentId)||!integer(c.notBefore)||!integer(c.expiresAt)||c.expiresAt<=c.notBefore||c.expiresAt-c.notBefore>86400000||!integer(c.maxRequestLifetimeMs)||c.maxRequestLifetimeMs<1000||c.maxRequestLifetimeMs>3600000||!Array.isArray(c.entries)||c.entries.length<1||c.entries.length>8||new TextEncoder().encode(canonical(c)).length>16384)stop('catalogue_invalid');
 const entryIds=new Set(),requests=new Set(),grants=new Set(),events=new Set();let total=0;
 for(const e of c.entries){
  if(!exact(e,['entryId','purpose','requestText','taskContext','inputSha256','slots'])||!slug(e.entryId)||entryIds.has(e.entryId)||!['public-source-review','sanitized-source-proposal'].includes(e.purpose)||!text(e.requestText,4000)||!exact(e.taskContext,['title','nextAction','latestFinding'])||!text(e.taskContext.title,200)||typeof e.taskContext.nextAction!=='string'||e.taskContext.nextAction.length>1500||typeof e.taskContext.latestFinding!=='string'||e.taskContext.latestFinding.length>4000||!hex(e.inputSha256)||await digest(canonical({requestText:e.requestText,taskContext:e.taskContext}))!==e.inputSha256||new TextEncoder().encode(JSON.stringify({request:e.requestText,context:e.taskContext})).length>12000||!Array.isArray(e.slots)||!e.slots.length)stop('catalogue_entry_invalid');entryIds.add(e.entryId);const slots=new Set();
  for(const s of e.slots){if(!exact(s,['slotId','requestId','grantId','eventId'])||!slug(s.slotId)||slots.has(s.slotId)||!uuid(s.requestId)||!uuid(s.grantId)||!hex(s.eventId)||await digest(canonical([c.ownerId,c.taskId,s.requestId]))!==s.eventId||requests.has(s.requestId)||grants.has(s.grantId)||events.has(s.eventId)||++total>8)stop('catalogue_slot_invalid');slots.add(s.slotId);requests.add(s.requestId);grants.add(s.grantId);events.add(s.eventId);}
 }
 return {entryCount:c.entries.length,slotCount:total,catalogueSha256:await digest(canonical(c))};
}
export async function planFiniteAdmission({mode,catalogue,costEnrollment,actor,selection,at,existingPayload=null}={}){
 if(mode!=='synthetic-review-only')stop('production_admission_not_implemented');
 const c=JSON.parse(JSON.stringify(catalogue));
 costEnrollment=JSON.parse(JSON.stringify(costEnrollment));
 actor=actor&&JSON.parse(JSON.stringify(actor));selection=selection&&JSON.parse(JSON.stringify(selection));
 existingPayload=existingPayload&&JSON.parse(JSON.stringify(existingPayload));
 const info=await validateCatalogue(c);
 // actor is a TRUSTED-CALLER PRECONDITION in this pure fixture. This object is
 // not an authentication proof. A real owner-session approval route is absent.
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
