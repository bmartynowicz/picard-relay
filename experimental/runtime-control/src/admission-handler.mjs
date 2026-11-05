// Explicitly disabled by default. Runtime wiring supplies existing owner auth.
import {canonical,digest,validateWork} from './protocol.mjs';
import {planFiniteAdmission,planWorkspaceDraft,validateWorkspaceDraft} from './admission-plan.mjs';
import {randomUUID} from 'node:crypto';
import {readBoundAdmissionPolicy} from './admission-policy.mjs';
import {AdmissionError,admissionHash,stop} from './admission-store.mjs';
import {recentJobReason} from './relay-store.mjs';

const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const headers={'Cache-Control':'no-store, private','Pragma':'no-cache','Content-Type':'application/json; charset=utf-8','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"};
const routes=new Map([['/request-catalogue','GET'],['/request-approvals','POST'],['/requests','POST']]);
const failureStatuses={auth_failed:401,request_invalid:400,request_too_large:413,admission_rate_limited:429,approval_invalid:409,approval_expired:409,approval_record_invalid:409,existing_record_invalid:409,scope_revoked:409,admission_blocked:503};

// Opt-in owner workspace. The signed Board endpoint keeps its own authority;
// a browser draft is never a signed Board attestation.
export function createWorkspaceHandler({enabled=false,auth,store,binding,origins=[],now=Date.now,loadPolicy,currentAvailability=()=>null,afterCommit=()=>{}}={}){
 if(enabled!==true)return async()=>false;
 if(!auth||!store||typeof loadPolicy!=='function')stop('admission_configuration_invalid');
 const allowed=new Set(origins),scope=admissionHash(canonical([binding.ownerId,'owner-workspace']));
 const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
 const knownStates=['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'];
 const ready=()=>{const a=currentAvailability();return a?.acceptingRequests===true&&(a.pendingUncertainty===false||a.isolatedFailures===true)&&a.costContradiction===false;};
 const policy=()=>readBoundAdmissionPolicy(loadPolicy,binding);
 let earnedCache=null;
 async function earnedProgress(){
  const version=store.workspaceProgressVersion();
  if(earnedCache?.version===version)return earnedCache.value;
  let acceptedWork=0;
  for(const ref of store.workspaceReviewedRefs()){
   const saved=await ownedResult(ref);
   if(saved.state==='completed'&&saved.resultAvailable&&saved.result.kind==='information'&&saved.review.latest?.decision==='accepted')acceptedWork++;
   if(acceptedWork===100)break;
  }
  // A concurrent review must not turn a mixed snapshot into earned credit.
  if(version!==store.workspaceProgressVersion())throw Error('progress_changed');
  const value={v:1,acceptedWork,atLeast:acceptedWork===100};earnedCache={version,value};return value;
 }
 function draft(id){const d=store.getWorkspaceDraft(id);if(!d)stop('not_registered');return validateWorkspaceDraft(d,binding);}
 async function ownedResult(ref){
  const row=store.get(ref);if(!row||row.owner!==binding.ownerId)stop('not_registered');
  let p;try{p=JSON.parse(row.payload_json);await validateWork(p);}catch{stop('existing_record_invalid');}
  if(p.ownerId!==binding.ownerId||p.assistantId!==binding.assistantId||p.eventId!==ref||row.task!==p.taskId||row.message_id!==p.requestId||row.grant_id!==p.grantId||row.payload_hash!==p.payloadHash||row.grant_expires!==p.grantExpiresAt||!knownStates.includes(row.state))stop('existing_record_invalid');
  const approved=store.getWorkspaceWork(ref)??store.getReusableBoard(ref);
  const response={v:1,ref,state:row.state,observedAt:new Date(now()).toISOString(),createdAt:row.created_at,updatedAt:row.updated_at,request:{title:p.context.title,text:p.request.text,context:p.context.latestFinding,taskId:p.taskId},resultAvailable:false,reasonCode:recentJobReason(row.state,row.last_error,row.state==='completed'&&!!row.result_json),review:store.workspaceReview(ref),provenance:{model:p.assistantId,requestId:p.requestId,inputSha256:admissionHash(canonical({requestText:p.request.text,taskContext:p.context})),payloadSha256:p.payloadHash,approvedAt:approved?.approval.issuedAt??Date.parse(p.request.createdAt),expiresAt:p.grantExpiresAt,maxOutputTokens:approved?.approval.maxCompletionTokens===4096?4096:512,source:store.getWorkspaceWork(ref)?'Owner console':store.getReusableBoard(ref)?'Signed task board':'Enrolled request',measuredTokens:null,billedUsd:null}};
  if(row.state==='completed'){
   let r;try{r=JSON.parse(row.result_json);}catch{stop('existing_record_invalid');}
   if(r?.v!==1||r.eventId!==ref||r.ownerId!==p.ownerId||r.taskId!==p.taskId||r.requestId!==p.requestId||r.grantId!==p.grantId||r.assistantId!==p.assistantId||r.payloadHash!==p.payloadHash||r.responseId!=='resp:'+ref||typeof r.body!=='string'||!r.body.trim()||r.body.length>16000||!['information','question'].includes(r.outcome?.kind))stop('existing_record_invalid');
   const resultSha256=admissionHash(r.body);if(response.review.history.some(review=>review.resultSha256!==resultSha256))stop('existing_record_invalid');
   response.resultAvailable=true;response.result={body:r.body,kind:r.outcome.kind,sha256:resultSha256};
  }
  return response;
 }
 return async(req,res)=>{
  const url=typeof req.url==='string'?req.url:'',readDraft=/^\/workspace\/drafts\/([a-f0-9-]{36})$/.exec(url),readResult=/^\/workspace\/requests\/([a-f0-9]{64})$/.exec(url),reviewPath=/^\/workspace\/reviews\/([a-f0-9]{64})$/.exec(url),historyPath=url==='/workspace/history'||url.startsWith('/workspace/history?');
  if(!(req.method==='GET'&&(url==='/workspace/config'||readDraft||readResult||historyPath)||req.method==='POST'&&(['/workspace/drafts','/workspace/approvals','/workspace/requests'].includes(url)||reviewPath)))return false;
  const reply=(status,value)=>{res.writeHead(status,headers);res.end(JSON.stringify(value));return true;};
  let origin;try{const host=req.headers.host,u=new URL('https://'+host);if(typeof host==='string'&&u.host===host&&!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash)origin=u.origin;}catch{}
  if(!allowed.has(origin)||req.headers.origin!==undefined&&req.headers.origin!==origin||!['same-origin','none',undefined].includes(req.headers['sec-fetch-site'])||req.method==='POST'&&req.headers.origin!==origin)return reply(403,{error:'auth_failed'});
  try{
   const cookies=typeof req.headers.cookie==='string'&&req.headers.cookie.length<=4096?req.headers.cookie.split(';').map(x=>x.trim()).filter(x=>x.startsWith('__Host-PicardSession=')):[];
   const token=cookies.length===1?cookies[0].slice('__Host-PicardSession='.length):'';
   if(!/^[A-Za-z0-9_-]{43}$/.test(token)||!await auth.authenticate(token))return reply(401,{error:'auth_failed'});
   if(req.method==='GET'){
    if(historyPath){
     const query=new URL(url,'https://fixture.invalid').searchParams;
     if([...query.keys()].some(k=>k!=='cursor')||query.getAll('cursor').length>1||query.has('cursor')&&!/^[A-Za-z0-9_-]{1,256}$/.test(query.get('cursor')))stop('request_invalid');
     const page=store.relay.recentJobs({ownerId:binding.ownerId,...(query.has('cursor')?{cursor:query.get('cursor')}:{})}),rows=[];
     for(const row of page.rows){const saved=store.get(row.ref);let p;try{p=JSON.parse(saved.payload_json);await validateWork(p);}catch{stop('existing_record_invalid');}if(saved.owner!==binding.ownerId||p.ownerId!==binding.ownerId||p.eventId!==row.ref||saved.payload_hash!==p.payloadHash)stop('existing_record_invalid');rows.push({...row,title:p.context.title});}
     return reply(200,{v:1,rows,nextCursor:page.nextCursor,observedAt:new Date(now()).toISOString()});
    }
    if(readDraft){if(!uuid.test(readDraft[1]))stop('request_invalid');const d=draft(readDraft[1]);return reply(200,{v:1,draft:d,registered:!!store.get(d.payload.eventId),state:store.get(d.payload.eventId)?.state??(d.approval.expiresAt<=now()?'expired':'draft'),observedAt:new Date(now()).toISOString()});}
    if(readResult){
     if(!store.get(readResult[1])){const d=store.getWorkspaceDraftByRef(readResult[1]);if(d){validateWorkspaceDraft(d,binding);return reply(200,{v:1,draft:d,registered:false,state:d.approval.expiresAt<=now()?'expired':'draft',observedAt:new Date(now()).toISOString()});}}
     return reply(200,await ownedResult(readResult[1]));
    }
    let enrolled=false;try{policy();enrolled=true;}catch{}
    const availability=currentAvailability();
    const jobs=store.relay.scopedStats({ownerId:binding.ownerId});
    let training=null,progress=null;try{
     const ref=store.workspaceReviewedRef(),saved=ref?await ownedResult(ref):null;
     training={v:1,hasSavedResult:jobs.some(row=>row.state==='completed'&&row.count>0),hasReviewedResult:!!(saved?.resultAvailable&&saved.review.revision>0)};
     if(training.hasReviewedResult&&!training.hasSavedResult)training=null;
    }catch{/* An unverifiable milestone never blocks status or result recovery. */}
    try{progress=await earnedProgress();}catch{/* Unknown credit never blocks saved results. */}
    return reply(200,{v:1,enabled:true,observedAt:new Date(now()).toISOString(),ready:enrolled&&ready(),blockingCode:enrolled?availability?.code??'configuration_unavailable':'configuration_unavailable',provider:'Groq',model:'openai/gpt-oss-20b',limits:{maxCalls:1,maxOutputTokens:4096,maxRequestCharacters:4000,maxContextCharacters:4000,maxTitleCharacters:200,maxCombinedInputBytes:12000,requestLifetimeMs:900000,approvalLifetimeMs:60000,activeJobs:8,attemptsPerMinute:10,tools:false,retries:0,paidFallback:false},training,progress,usage:{jobs,measuredTokens:null,billedUsd:null,liveBillingVerified:false},setup:{ownerAuthentication:true,durableStorage:true,providerEnrollment:enrolled,backupStatus:'operator_managed'}});
   }
   store.recordAttempt(scope);
   if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type']??''))stop('request_invalid');
   let size=0;const chunks=[];for await(const part of req){const bytes=Buffer.from(part);size+=bytes.length;if(size>24576)stop('request_too_large');chunks.push(bytes);}
   let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{stop('request_invalid');}
   if(url==='/workspace/drafts'){
    policy();const d=await planWorkspaceDraft({body,binding,at:now(),grantId:randomUUID()});
    const saved=store.saveWorkspaceDraft(d);return reply(201,{v:1,draft:saved,registered:!!store.get(saved.payload.eventId),state:store.get(saved.payload.eventId)?.state??(saved.approval.expiresAt<=now()?'expired':'draft'),observedAt:new Date(now()).toISOString()});
   }
   if(reviewPath){
    if(!exact(body,['expectedRevision','decision','note','resultSha256']))stop('request_invalid');
    await ownedResult(reviewPath[1]);const review=store.saveWorkspaceReview({ref:reviewPath[1],...body});return reply(200,{v:1,review});
   }
   if(!exact(body,url==='/workspace/approvals'?['requestId']:['requestId','nonce','draftSha256','approve'])||!uuid.test(body.requestId??''))stop('request_invalid');
   const d=draft(body.requestId),p=policy(),row=store.get(d.payload.eventId),sessionSha256=admissionHash(token);
   const identity={scope,sessionSha256,catalogueSha256:binding.configurationSha256,entryId:body.requestId,slotId:'workspace',inputSha256:d.draftSha256};
   if(url==='/workspace/approvals'){
    if(row)return reply(200,{v:1,existing:true,ref:row.event_id,state:row.state});
    if(!ready())stop('admission_blocked');if(d.approval.expiresAt<=now())stop('approval_expired');
    return reply(200,{v:1,ref:d.payload.eventId,draftSha256:d.draftSha256,...store.issue({...identity,catalogueExpiresAt:d.approval.expiresAt})});
   }
   if(body.approve!==true||body.draftSha256!==d.draftSha256)stop('approval_invalid');
   const result=store.commitWorkspace({draft:d,proof:{...identity,nonce:body.nonce},currentAvailability,revalidate:()=>policy().catalogueSha256===p.catalogueSha256&&draft(body.requestId).draftSha256===d.draftSha256});
   await afterCommit();return reply(result.duplicate?200:201,{v:1,...result});
  }catch(error){
   const statuses={...failureStatuses,not_registered:404,draft_conflict:409,review_conflict:409,review_unavailable:409,review_invalid:503,queue_capacity:429,approval_capacity:429};
   const code=Object.hasOwn(statuses,error?.code)?error.code:'workspace_unavailable';return reply(statuses[code]??503,{error:code,mayInvoke:false});
  }
 };
}
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
     if(result?.v!==1||result.eventId!==ref||result.ownerId!==work.ownerId||result.taskId!==work.taskId||result.requestId!==work.requestId||result.grantId!==work.grantId||result.payloadHash!==work.payloadHash||result.assistantId!==work.assistantId||result.responseId!=='resp:'+ref||typeof result.body!=='string'||!result.body.trim()||result.body.length>16000||!['information','question'].includes(result.outcome?.kind))stop('existing_record_invalid');
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
