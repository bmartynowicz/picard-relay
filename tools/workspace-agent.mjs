import {request as httpsRequest} from 'node:https';
import {createHash} from 'node:crypto';
import {workspaceOrigin,createReadOnlyWorkspace,WORKSPACE_READ_LIMITS} from './workspace-readonly.mjs';
import {createWorkspaceAccessCache,validToolAccess} from './workspace-access-cache.mjs';
import {checkedDraft,verifyDraft} from './workspace-request.mjs';
import {canonical} from '../experimental/runtime-control/src/protocol.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash=/^[a-f0-9]{64}$/;
const exact=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...fields].sort().join(',');
const check=(v,code='invalid_workspace_response')=>{if(!v)throw Error(code);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const errors=new Set(['auth_failed','approval_invalid','approval_expired','admission_blocked','scope_revoked','admission_rate_limited','queue_capacity','not_registered','draft_conflict','request_invalid']);

// Only the two fixed write routes are exposed; no login, owner approval,
// arbitrary URL, redirect or execution retry exists in the tool process.
export function writeWorkspaceHttps({origin,path,authorization,body}){
 check(['/workspace/drafts','/workspace/requests'].includes(path),'invalid_arguments');
 const bytes=Buffer.from(JSON.stringify(body));check(bytes.length<=24576,'invalid_arguments');
 return new Promise((resolve,reject)=>{
  const req=httpsRequest(origin+path,{method:'POST',rejectUnauthorized:true,signal:AbortSignal.timeout(10000),headers:{Accept:'application/json',Origin:origin,Authorization:authorization,'Content-Type':'application/json','Content-Length':bytes.length}},res=>{
   if(res.statusCode>=300&&res.statusCode<400){res.destroy();resolve({status:res.statusCode});return;}
   if(!/^application\/json(?:;|$)/i.test(res.headers['content-type']??'')){res.destroy();reject(Error('invalid_workspace_response'));return;}
   const chunks=[];let size=0;
   res.on('data',part=>{size+=part.length;if(size>WORKSPACE_READ_LIMITS.responseBytes){res.destroy();reject(Error('workspace_response_too_large'));}else chunks.push(part);});
   res.on('error',()=>reject(Error('response_unconfirmed')));
   res.on('end',()=>{try{resolve({status:res.statusCode,data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))});}catch{reject(Error('invalid_workspace_response'));}});
  });
  req.on('error',()=>reject(Error('response_unconfirmed')));req.end(bytes);
 });
}
export function createAgentWorkspace({origin,readAccess,readTransport,writeTransport=writeWorkspaceHttps,now=Date.now}={}){
 origin=workspaceOrigin(origin);const load=readAccess??(()=>createWorkspaceAccessCache().read(origin));let access=null;
 async function credential(){
  check(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','tls_verification_required');
  if(!validToolAccess(access,origin,now())){try{access=await load(origin);}catch{throw Error('tool_access_required');}}
  check(validToolAccess(access,origin,now()),'tool_access_required');return access;
 }
 const reader=createReadOnlyWorkspace({origin,now,readSession:credential,...(readTransport?{transport:readTransport}:{})});
 const reads=Object.fromEntries(['status','list','get'].map(method=>[method,async args=>{
  try{return await reader[method](args);}catch(e){throw Error(e.message==='owner_sign_in_required'?'tool_access_required':e.message);}
 }]));
 async function post(path,body){
  const c=await credential();check(c.mode==='approved-work','workspace_access_denied');
  const response=await writeTransport({origin,path,authorization:'Bearer '+c.token,body});
  if(response.status===401){access=null;throw Error('tool_access_required');}
  if(response.status===403)throw Error('workspace_access_denied');
  if(response.status>=300&&response.status<400)throw Error('workspace_redirect_rejected');
  if(response.status>=500)throw Error('response_unconfirmed');
  if(![200,201].includes(response.status))throw Error(errors.has(response.data?.error)?response.data.error:'workspace_request_failed');
  check(response.data?.v===1);check(!JSON.stringify(response.data).includes(c.token));return response.data;
 }
 async function savedDraft(requestId){
  // Recovery is a read of the same identity, never a second prepare or submit.
  const projected=await reads.get({ref:requestId});return projected;
 }
 return {...reads,
  async prepare(args){
   let brief;try{brief=checkedDraft(args);}catch{throw Error('invalid_arguments');}
   let response;
   try{response=await post('/workspace/drafts',brief);}catch(e){
    if(!['response_unconfirmed','invalid_workspace_response','workspace_response_too_large'].includes(e.message))throw e;
    // A readback reports the known request identity without silently approving it.
    try{return {...await savedDraft(brief.requestId),readOnly:false,requestId:brief.requestId,draftSha256:null,approvalRequired:true,recovery:'read-only',nextAction:'Read the exact saved draft with the owner CLI before approving.'};}catch{throw Error('draft_unconfirmed');}
   }
   const d=response.draft,p=d?.payload;check(p?.requestId===brief.requestId&&hash.test(p?.eventId));
   check(sha(canonical([p.ownerId,p.taskId,p.requestId]))===p.eventId);
   const {payloadHash,...payload}=p;check(sha(canonical(payload))===payloadHash);
   await verifyDraft(response,brief,p.eventId);
   return {readOnly:false,requestId:p.requestId,ref:p.eventId,state:response.state,draftSha256:d.draftSha256,expiresAt:d.approval.expiresAt,approvalRequired:!response.registered,
    request:{title:brief.title,text:brief.requestText,context:brief.context,taskId:p.taskId,purpose:brief.purpose},nextAction:response.registered?'Read the saved request.':'Owner must approve this exact draft for this tool before submission.'};
  },
  async submit(args){
   check(exact(args,['requestId','draftSha256','nonce'])&&uuid.test(args.requestId)&&hash.test(args.draftSha256)&&/^[A-Za-z0-9_-]{43}$/.test(args.nonce),'invalid_arguments');
   let receipt;
   try{receipt=await post('/workspace/requests',{...args,approve:true});check(hash.test(receipt.ref)&&typeof receipt.duplicate==='boolean'&&['queued','claimed','invoking','completed','failed','blocked','cancelled','uncertain'].includes(receipt.state));}
   catch(e){
    if(!['response_unconfirmed','invalid_workspace_response','workspace_response_too_large'].includes(e.message))throw e;
    try{const saved=await savedDraft(args.requestId);if(!['draft','expired'].includes(saved.state))return {...saved,readOnly:false,recovery:'read-only'};}catch{}
    throw Error('submission_unconfirmed');
   }
   // Validate the receipt against the saved UUID, including duplicate outcomes.
   const saved=await savedDraft(args.requestId);check(saved.ref===receipt.ref&&saved.state!=='draft'&&saved.state!=='expired');
   return {...saved,readOnly:false,duplicate:receipt.duplicate};
  }
 };
}
