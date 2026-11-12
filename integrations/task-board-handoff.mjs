// Portable data contract only. No credentials, network, approval or execution.
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.prototype.toString.call(v)==='[object Object]';
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
export const HANDOFF_LIFETIME_MS=3600000;
export function handoffCanonical(v){
 if(Array.isArray(v))return '['+v.map(handoffCanonical).join(',')+']';
 if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+handoffCanonical(v[k])).join(',')+'}';
 return JSON.stringify(v);
}
export async function handoffDigest(v){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(handoffCanonical(v))))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export function validateHandoffInput(v){
 const fail=()=>{throw Error('handoff_input_invalid');};
 if(!exact(v,['taskId','expectedRevision','requestText','taskContext','provenance','outputTokenLimit','idempotencyKey'])||!text(v.taskId,200)||!/^[A-Za-z0-9_.:-]+$/.test(v.taskId)||!Number.isSafeInteger(v.expectedRevision)||v.expectedRevision<1||v.expectedRevision>=Number.MAX_SAFE_INTEGER||!text(v.requestText,4000)||!exact(v.taskContext,['title','nextAction','latestFinding'])||!text(v.taskContext.title,200)||!text(v.taskContext.nextAction,1500)||!text(v.taskContext.latestFinding,4000)||!['synthetic','public_source','sanitized_private'].includes(v.provenance)||![512,4096].includes(v.outputTokenLimit)||typeof v.idempotencyKey!=='string'||!/^[A-Za-z0-9_.:-]{8,128}$/.test(v.idempotencyKey))fail();
 if(new TextEncoder().encode(handoffCanonical({requestText:v.requestText,taskContext:v.taskContext})).length>12000)fail();
 return JSON.parse(JSON.stringify(v));
}
export async function createHandoffDraft(ownerId,raw,{id,requestId,grantId,now}={}){
 const input=validateHandoffInput(raw);
 if(!text(ownerId,200)||!uuid(id)||!uuid(requestId)||!uuid(grantId)||!Number.isSafeInteger(now)||now<0||!Number.isSafeInteger(now+HANDOFF_LIFETIME_MS))throw Error('handoff_binding_invalid');
 const value={v:1,id,ownerId,input,requestId,grantId,eventId:await handoffDigest([ownerId,input.taskId,requestId]),inputHash:await handoffDigest({requestText:input.requestText,taskContext:input.taskContext}),createdAt:now,expiresAt:now+HANDOFF_LIFETIME_MS};
 return {...value,draftSha256:await handoffDigest(value)};
}
export async function validateHandoffDraft(v,ownerId,taskId){
 if(!exact(v,['v','id','ownerId','input','requestId','grantId','eventId','inputHash','createdAt','expiresAt','draftSha256'])||v.v!==1||v.ownerId!==ownerId||v.input?.taskId!==taskId)throw Error('handoff_binding_invalid');
 const rebuilt=await createHandoffDraft(ownerId,v.input,{id:v.id,requestId:v.requestId,grantId:v.grantId,now:v.createdAt});
 if(handoffCanonical(rebuilt)!==handoffCanonical(v))throw Error('handoff_binding_invalid');
 return rebuilt;
}
/** @param {{expiresAt?:number,currentRevision?:number,expectedRevision?:number,grant?:{revokedAt:number|null}|null,work?:{state:string,last_error?:string|null}|null,now?:number}} [options] */
export function handoffState({expiresAt,currentRevision,expectedRevision,grant=null,work=null,now=Date.now()}={}){
 // Persisted outcomes take precedence over clocks or later task edits.
 if(work?.state==='completed')return 'completed';
 if(work?.last_error==='invocation_outcome_uncertain')return 'uncertain';
 if(work)return ({queued:'queued',claimed:'running',blocked:'blocked',failed:'failed',cancelled:'cancelled'})[work.state]??'unknown';
 if(grant?.revokedAt!=null)return 'revoked';
 if(Number.isSafeInteger(expiresAt)&&expiresAt<=now)return 'expired';
 if(currentRevision!==expectedRevision)return 'stale';
 return grant?'approved_not_sent':'awaiting_owner_approval';
}
