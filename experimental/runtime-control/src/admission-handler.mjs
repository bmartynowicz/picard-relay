// Explicitly disabled by default. Runtime wiring supplies existing owner auth.
import {canonical,digest,validateWork} from './protocol.mjs';
import {planFiniteAdmission} from './admission-plan.mjs';
import {readBoundAdmissionPolicy} from './admission-policy.mjs';
import {AdmissionError,admissionHash,stop} from './admission-store.mjs';
import {recentJobReason} from './relay-store.mjs';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const headers={'Cache-Control':'no-store, private','Pragma':'no-cache','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const routes=new Map([['/request-catalogue','GET'],['/request-approvals','POST'],['/requests','POST']]);
const failureStatuses={auth_failed:401,request_invalid:400,request_too_large:413,admission_rate_limited:429,approval_invalid:409,approval_expired:409,approval_record_invalid:409,existing_record_invalid:409,scope_revoked:409,admission_blocked:503};
export function createLocalAdmissionHandler({mode,...options}={}){
 if(mode!=='synthetic-integration-only')stop('production_admission_disabled');
 return createHandler({...options,fixture:true});
}
export function createAdmissionHandler({activationEnabled=false,...options}={}){
 if(activationEnabled!==true)return async()=>false;
 return createHandler({...options,fixture:false});
}
function createHandler({auth,store,loadPolicy,binding,origins=[],now=Date.now,currentAvailability=()=>null,afterCommit=()=>{},fixture}){
 if(store?.localTestOnly!==fixture||typeof auth?.authenticate!=='function'||typeof loadPolicy!=='function'||!exact(binding,['ownerId','taskId','assistantId','enrollmentId','keySha256','configurationSha256']))stop('admission_configuration_invalid');
 binding=JSON.parse(JSON.stringify(binding));
 const allowed=new Set(origins.filter(value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password;}catch{return false;}}));
 const scope=admissionHash(canonical([binding.ownerId,binding.taskId]));
 async function ownedSlot(c,entry,slot){
  const row=store.get(slot.eventId);if(!row)return null;
  try{
   const p=JSON.parse(row.payload_json);await validateWork(p);
   if(row.owner!==binding.ownerId||row.task!==binding.taskId||row.message_id!==slot.requestId||row.grant_id!==slot.grantId||row.payload_hash!==p.payloadHash||p.ownerId!==binding.ownerId||p.taskId!==binding.taskId||p.requestId!==slot.requestId||p.grantId!==slot.grantId||p.assistantId!==c.assistantId||p.request.text!==entry.requestText||p.request.answerTo!==null||canonical(p.context)!==canonical(entry.taskContext))stop('existing_record_invalid');
   return row;
  }catch{stop('existing_record_invalid');}
 }
 function policy(){
  // A synchronous stable reader can be revalidated inside the SQLite commit.
  const value=loadPolicy();if(value&&typeof value.then==='function'){void Promise.resolve(value).catch(()=>{});stop('catalogue_unavailable');}return readBoundAdmissionPolicy(()=>value,binding);
 }
 const tokenFrom=req=>{const cookie=req.headers.cookie;if(typeof cookie!=='string'||cookie.length>4096)return null;const found=cookie.split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-PicardSession='));if(found.length!==1)return null;const token=found[0].slice('__Host-PicardSession='.length);return /^[A-Za-z0-9_-]{43}$/.test(token)?token:null;};
 return async(req,res)=>{
  const resultPath=req.method==='GET'&&typeof req.url==='string'&&/^\/requests\/[a-f0-9]{64}$/.test(req.url);
  if(!resultPath&&routes.get(req.url)!==req.method)return false;
  const reply=(status,body)=>{res.writeHead(status,headers);res.end(JSON.stringify(body));return true;};
  let origin;try{const host=req.headers.host,u=new URL('https://'+host);if(typeof host==='string'&&u.host===host&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash)origin=u.origin;}catch{}
  // Exact Host/Origin and same-origin fetch boundary apply even to private GET.
  if(!allowed.has(origin)||req.headers.origin!==undefined&&req.headers.origin!==origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])||req.method==='POST'&&req.headers.origin!==origin)return reply(403,{error:'auth_failed'});
  try{
   const token=tokenFrom(req);if(!token||!await auth.authenticate(token))return reply(401,{error:'auth_failed'});
   if(resultPath){
    const ref=req.url.slice('/requests/'.length),row=store.get(ref);if(!row)return reply(404,{error:'not_registered',mayInvoke:false});
    let work;try{work=JSON.parse(row.payload_json);await validateWork(work);}catch{stop('existing_record_invalid');}
    if(row.owner!==binding.ownerId||row.task!==binding.taskId||work.ownerId!==binding.ownerId||work.taskId!==binding.taskId||work.assistantId!==binding.assistantId||row.payload_hash!==work.payloadHash)return reply(403,{error:'auth_failed'});
    const states=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'];if(!states.includes(row.state))stop('existing_record_invalid');
    const body={v:1,ref,state:row.state,mayInvoke:false,resultAvailable:false,reasonCode:recentJobReason(row.state,row.last_error,row.state==='completed'&&!!row.result_json)};
    if(row.state==='completed'){
     let result;try{result=JSON.parse(row.result_json);}catch{stop('existing_record_invalid');}
     if(result?.v!==1||result.eventId!==ref||result.ownerId!==work.ownerId||result.taskId!==work.taskId||result.requestId!==work.requestId||result.grantId!==work.grantId||result.payloadHash!==work.payloadHash||result.assistantId!==work.assistantId||result.responseId!=='resp:'+ref||typeof result.body!=='string'||!result.body.trim()||result.body.length>4000||!['information','question'].includes(result.outcome?.kind))stop('existing_record_invalid');
     body.resultAvailable=true;body.result={body:result.body,kind:result.outcome.kind};
    }
    return reply(200,body);
   }
   const sessionSha256=admissionHash(token),p=await policy(),c=p.catalogue,at=now();
   if(!Number.isSafeInteger(at)||at<c.notBefore||at>=c.expiresAt)stop('catalogue_unavailable');
   if(req.method==='GET'){
    const entries=[];for(const e of c.entries){const slots=[];for(const s of e.slots){const old=await ownedSlot(c,e,s),state=old?.state??'available';slots.push({slotId:s.slotId,ref:s.eventId,state:['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain','available'].includes(state)?state:'unknown'});}entries.push({entryId:e.entryId,purpose:e.purpose,requestText:e.requestText,taskContext:e.taskContext,inputSha256:e.inputSha256,slots});}
    const ready=currentAvailability(),admissionReady=!fixture&&ready?.acceptingRequests===true&&(ready.pendingUncertainty===false||ready.isolatedFailures===true)&&ready.costContradiction===false;
    const codes=['ready','pending_uncertainty','catalogue_expired','catalogue_unavailable','configuration_unavailable','relay_busy_or_draining','allowance_unavailable','legacy_review_required'];
    return reply(200,{v:1,mode:fixture?'synthetic-integration-only':'enabled',mayInvoke:admissionReady,admissionReady,blockingCode:codes.includes(ready?.code)?ready.code:'configuration_unavailable',catalogueSha256:p.catalogueSha256,expiresAt:c.expiresAt,policy:{maxCallsPerSlot:1,totalSlots:p.slotCount,maxOutputTokens:512,budgetUsd:0,tools:false,retries:0,paidFallback:false},entries});
   }
   // Durable bounded owner-wide attempt budget also counts invalid submissions.
   store.recordAttempt(scope);
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))stop('request_invalid');
   let size=0,parts=[];for await(const part of req){const bytes=Buffer.from(part);size+=bytes.length;if(size>1024)stop('request_too_large');parts.push(bytes);}
   let body;try{const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts));body=JSON.parse(raw);if(canonical(body)!==raw)stop('request_invalid');}catch{stop('request_invalid');}
   const fields=req.url==='/request-approvals'?['entryId','slotId']:['entryId','slotId','nonce','approvedInputSha256','approve'];
   if(!exact(body,fields)||typeof body.entryId!=='string'||typeof body.slotId!=='string')stop('request_invalid');
   const entry=c.entries.find(e=>e.entryId===body.entryId),slot=entry?.slots.find(s=>s.slotId===body.slotId);if(!entry||!slot)stop('request_invalid');
   const selection={entryId:entry.entryId,slotId:slot.slotId};
   if(req.url==='/request-approvals'){
    // Reopening an already registered slot never creates a fresh nonce or grant.
    const old=await ownedSlot(c,entry,slot);if(old){const state=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].includes(old.state)?old.state:'unknown';return reply(200,{v:1,mode:fixture?'synthetic-integration-only':'enabled',mayInvoke:false,existing:true,ref:slot.eventId,state});}
    const ready=currentAvailability();if(ready?.acceptingRequests!==true||(ready.pendingUncertainty!==false&&ready.isolatedFailures!==true)||ready.costContradiction!==false)stop('admission_blocked');
    const challenge=store.issue({scope,sessionSha256,catalogueSha256:p.catalogueSha256,...selection,inputSha256:entry.inputSha256,catalogueExpiresAt:c.expiresAt});
    return reply(200,{v:1,mode:fixture?'synthetic-integration-only':'enabled',mayInvoke:false,...selection,approvedInputSha256:entry.inputSha256,...challenge});
   }
   if(body.approve!==true||body.approvedInputSha256!==entry.inputSha256)stop('request_invalid');
   const proof={scope,nonce:body.nonce,sessionSha256,catalogueSha256:p.catalogueSha256,...selection,inputSha256:entry.inputSha256},existing=store.inspect(proof);
   if(!existing.record.used&&existing.record.expiresAt<=now())stop('approval_expired');
   const plan=await planFiniteAdmission({mode:'synthetic-review-only',catalogue:c,costEnrollment:p.costEnrollment,actor:{ownerId:binding.ownerId,approvedInputSha256:entry.inputSha256,approvedAt:at,approvalRef:'authenticated-session-bound-nonce'},selection,at});
   const result=store.commit({proof,plan,catalogue:c,selection,currentAvailability,revalidate:()=>policy().catalogueSha256===p.catalogueSha256});
   // Lost response after this point must recover the original row and clocks.
   await afterCommit();
   return reply(result.duplicate?200:201,{v:1,mode:fixture?'synthetic-integration-only':'enabled',mayInvoke:!fixture,admissionReady:!fixture,...result});
  }catch(e){const code=e instanceof AdmissionError&&Object.hasOwn(failureStatuses,e.code)?e.code:'admission_unavailable';return reply(failureStatuses[code]??503,{error:code,mayInvoke:false});}
 };
}
