import {canonical} from './protocol.mjs';
import {validateCatalogueSync} from './admission-plan.mjs';
import {validCostEnrollmentMetadata} from './admission-enrollment.mjs';
import {admissionHash,stop} from './admission-store.mjs';
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function readBoundAdmissionPolicy(loadPolicy,binding){
 const raw=JSON.parse(JSON.stringify(loadPolicy()));
 if(!exact(raw,['v','catalogue','costEnrollment','configurationSha256'])||raw.v!==1)stop('catalogue_unavailable');
 const {catalogue:c,costEnrollment:e}=raw,info=validateCatalogueSync(c);
 if(raw.configurationSha256!==binding.configurationSha256||c.ownerId!==binding.ownerId||c.taskId!==binding.taskId||c.assistantId!==binding.assistantId||c.enrollmentId!==binding.enrollmentId||!validCostEnrollmentMetadata(e)||e.owner!==c.ownerId||e.enrolledAt>c.notBefore||e.keySha256!==binding.keySha256||admissionHash(canonical(e))!==c.enrollmentId)stop('catalogue_unavailable');
 return {...raw,...info};
}
export function locateAdmissionSlot(policy,eventId){
 for(const entry of policy.catalogue.entries){const slot=entry.slots.find(s=>s.eventId===eventId);if(slot)return {entry,slot};}
 return null;
}
export function gateFromCommittedWork(policy,entry,slot,payload,{allowShorterLifetime=false}={}){
 const c=policy.catalogue,e=policy.costEnrollment,issued=Date.parse(payload?.request?.createdAt);
 const copy={...payload};delete copy.payloadHash;
 const ceiling=Math.min(issued+c.maxRequestLifetimeMs,c.expiresAt),expires=allowShorterLifetime?payload?.grantExpiresAt:ceiling;
 if(!exact(payload,['v','eventId','ownerId','taskId','requestId','grantId','assistantId','grantExpiresAt','payloadHash','request','context'])||!exact(payload.request,['text','createdAt','answerTo'])||!Number.isSafeInteger(issued)||new Date(issued).toISOString()!==payload.request.createdAt||issued<c.notBefore||issued>=c.expiresAt||payload.v!==1||payload.eventId!==slot.eventId||payload.ownerId!==c.ownerId||payload.taskId!==c.taskId||payload.requestId!==slot.requestId||payload.grantId!==slot.grantId||payload.assistantId!==c.assistantId||payload.grantExpiresAt!==expires||payload.request.answerTo!==null||payload.request.text!==entry.requestText||canonical(payload.context)!==canonical(entry.taskContext)||admissionHash(canonical(copy))!==payload.payloadHash)stop('existing_record_invalid');
 if(!Number.isSafeInteger(expires)||expires>ceiling||expires-issued<1000)stop('existing_record_invalid');
 return {v:3,purpose:entry.purpose,provider:'groq',model:e.model,accountPlan:'Free',noPaidFallback:true,harmlessTestOnly:true,maxCalls:1,owner:c.ownerId,task:c.taskId,grantId:slot.grantId,eventId:slot.eventId,approvedRequestText:entry.requestText,taskContext:entry.taskContext,approvedInputSha256:entry.inputSha256,enrollmentId:c.enrollmentId,costEnrollment:e,requestIssuedAt:issued,requestExpiresAt:expires};
}
