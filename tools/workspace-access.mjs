#!/usr/bin/env node
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {connectWorkspace} from './workspace-request.mjs';
import {workspaceOrigin} from './workspace-readonly.mjs';
import {createWorkspaceAccessCache,validToolAccess} from './workspace-access-cache.mjs';
import {validateWorkspaceDraft} from '../experimental/runtime-control/src/admission-plan.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const check=(v,code)=>{if(!v)throw Error(code);};
export async function manageWorkspaceAccess({command,origin,label,mode='read',days=7,clientId,requestId,draftSha256,approve=false,request,cache=createWorkspaceAccessCache(),now=Date.now}={}){
 origin=workspaceOrigin(origin);check(['enroll','list','revoke','approve'].includes(command),'invalid_command');
 if(command==='enroll'){
  check(typeof label==='string'&&label.trim()===label&&label.length>0&&label.length<=80&&!/[\x00-\x1f\x7f]/.test(label)&&['read','approved-work'].includes(mode)&&Number.isInteger(days)&&days>=1&&days<=30,'invalid_arguments');
  const result=await request('/workspace/clients',{label,mode,lifetimeMs:days*86400000}),c=result?.client;
  const value={v:1,origin,clientId:c?.id,token:result?.token,mode:c?.mode,expiresAt:c?.expiresAt};
  check(result?.v===1&&c?.label===label&&c.origin===origin&&c.mode===mode&&validToolAccess(value,origin,now())&&c.expiresAt<=now()+days*86400000+5000,'invalid_tool_access');
  try{await cache.write(value);}catch{throw Error('tool_access_save_failed_revoke_client_'+c.id);}
  const {id,createdAt,expiresAt,lastSeenAt,revokedAt}=c;
  return {v:1,client:{id,origin,label,mode,createdAt,expiresAt,lastSeenAt,revokedAt},stored:true};
 }
 if(command==='list')return request('/workspace/clients');
 check(uuid.test(clientId??''),'invalid_client_id');
 if(command==='revoke'){
  const result=await request('/workspace/clients/'+clientId+'/revoke',{});
  try{if((await cache.read(origin))?.clientId===clientId)await cache.clear(origin);}catch{/* Server revocation is authoritative, even when local cache is unavailable. */}
  return result;
 }
 check(approve===true&&uuid.test(requestId??'')&&/^[a-f0-9]{64}$/.test(draftSha256??''),'exact_approval_required');
 const saved=await request('/workspace/drafts/'+requestId),d=saved?.draft;
 check(d?.payload?.requestId===requestId&&d.draftSha256===draftSha256,'draft_does_not_match');
 // Validate the immutable draft before granting its nonce; never approve new text.
 validateWorkspaceDraft(d,{ownerId:d.payload.ownerId,assistantId:d.payload.assistantId,enrollmentId:d.approval?.enrollmentId,configurationSha256:d.configurationSha256});
 return request('/workspace/client-approvals',{clientId,requestId,draftSha256});
}
async function main(){
 const {values,positionals,tokens}=parseArgs({allowPositionals:true,tokens:true,options:{origin:{type:'string'},label:{type:'string'},mode:{type:'string'},days:{type:'string'},'client-id':{type:'string'},'request-id':{type:'string'},'draft-sha256':{type:'string'},approve:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){process.stderr.write('Usage: node tools/workspace-access.mjs enroll|list|revoke|approve --origin HTTPS_ORIGIN\nenroll: --label NAME [--mode read|approved-work] [--days 1..30]\nrevoke: --client-id UUID\napprove: --client-id UUID --request-id UUID --draft-sha256 HASH --approve\nOwner-only enrollment/approval; raw tool token is stored securely, never printed.\n');return;}
 check(positionals.length===1&&values.origin&&new Set(tokens.filter(t=>t.kind==='option').map(t=>t.name)).size===tokens.filter(t=>t.kind==='option').length,'invalid_arguments');
 const origin=workspaceOrigin(values.origin);let connection;
 const request=async(...args)=>(await(connection??=connectWorkspace(origin)))(...args);
 const result=await manageWorkspaceAccess({command:positionals[0],origin,label:values.label,mode:values.mode,days:values.days===undefined?7:Number(values.days),clientId:values['client-id'],requestId:values['request-id'],draftSha256:values['draft-sha256'],approve:values.approve,request});
 process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(e=>{process.stderr.write(JSON.stringify({error:/^[a-z_0-9-]{1,140}$/.test(e.message)?e.message:'tool_access_failed'})+'\n');process.exitCode=1;});
