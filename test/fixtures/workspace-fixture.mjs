// Disposable qualification harness. All provider output is local synthetic data.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Readable} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {canonical,digest} from '../../experimental/runtime-control/src/protocol.mjs';
import {createLocalAdmissionStore} from '../../experimental/runtime-control/src/admission-store.mjs';
import {createWorkspaceHandler} from '../../experimental/runtime-control/src/admission-handler.mjs';
import {createAdmissionAssistantAdapter} from '../../experimental/runtime-control/src/admission-dispatch.mjs';
import {priorGroqEnrollmentIds} from '../../experimental/runtime-control/src/admission-enrollment.mjs';
import {createDispatcher} from '../../experimental/runtime-control/src/dispatcher.mjs';

export const fixtureToken='A'.repeat(43),fixtureOrigin='https://fixture.invalid';
export async function workspaceFixture({realMarkers=process.platform==='linux',auth=null,directory=null,preserveLegacyBaseline=false,origin=fixtureOrigin,publicTestEnabled=false,answerText=null,readHistoricalModelProof=null}={}){
 const dir=directory??fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'picard-workspace-'));
 fs.chmodSync(dir,0o700);fs.writeFileSync(path.join(dir,'fixture-only.marker'),'PICARD_SYNTHETIC_ADMISSION_ONLY\n');
 let offset=0,calls=0,failResponse=false,mode='complete',available=true,session=fixtureToken,store,router,handler,dispatcher;
 const now=()=>Date.now()+offset,at=now();let apiKey='SYNTHETIC_WORKSPACE_KEY_ONLY';
 const enrollment={v:1,owner:'fixture-owner',provider:'groq',model:'openai/gpt-oss-20b',accountLabel:'Synthetic',organizationId:'synthetic',projectId:'synthetic',keySha256:await digest(apiKey),accountPlan:'Free',noPaidFallback:true,verifiedAt:at-86400000,enrolledAt:at-10000,evidenceRef:'SYNTHETIC_ONLY',keyAssociationEvidenceRef:'SYNTHETIC_ONLY'};
 const binding={ownerId:enrollment.owner,taskId:'legacy-fixture',assistantId:'groq:'+enrollment.model,enrollmentId:await digest(canonical(enrollment)),keySha256:enrollment.keySha256,configurationSha256:'b'.repeat(64),...(publicTestEnabled?{publicTestOrigin:'https://public.example'}:{})};
 const originalBaseline=Object.freeze({v:1,kind:'PICARD_LEGACY_BASELINE_V1',enrollmentId:binding.enrollmentId,ownerId:binding.ownerId,taskId:binding.taskId,assistantId:binding.assistantId,observedAt:at,rows:Object.freeze([])});
 let priorEnrollmentIds=[];
 const policy={v:1,configurationSha256:binding.configurationSha256,costEnrollment:enrollment,catalogue:{v:1,kind:'FINITE_ADMISSION_PROTOTYPE_ONLY',ownerId:binding.ownerId,taskId:binding.taskId,assistantId:binding.assistantId,enrollmentId:binding.enrollmentId,notBefore:at-1000,expiresAt:at+3600000,maxRequestLifetimeMs:600000,entries:[]}};
 const dbPath=path.join(dir,'admission-fixture.sqlite'),spent=new Set();
 const output=answerText??'## Synthetic proposal\n\nA saved code proposal for your review.\n\n```javascript\nexport function statusLabel(state) {\n  return state === "completed" ? "Ready for review" : "In progress";\n}\n```\n\n| Check | Expected |\n| --- | --- |\n| completed | Ready for review |\n| queued | In progress |\n\n<unsafe-tag> remains plain text.';
 const fetchImpl=async(_url,options)=>{
  calls++;const body=JSON.parse(options.body);if(body.max_completion_tokens!==(publicTestEnabled?512:4096))throw Error('wrong_token_ceiling');
  if(mode==='uncertain')throw Error('synthetic_transport_failure');
  if(mode==='unauthorized')return new Response(null,{status:401});
  return new Response(JSON.stringify({id:'synthetic-response',model:enrollment.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:output}}],usage:{prompt_tokens:50,completion_tokens:100,total_tokens:150}}));
 };
 function open(){
  const legacyBinding={...binding,enrollmentId:priorEnrollmentIds.includes(originalBaseline.enrollmentId)?originalBaseline.enrollmentId:binding.enrollmentId};
  const legacy=preserveLegacyBaseline?{legacyBinding,loadLegacyBaseline:()=>originalBaseline,readLegacyMarkers:()=>[]}:{};
  store=createLocalAdmissionStore({mode:'synthetic-integration-only',dbPath,now,reusableBoardEnabled:true,workspaceEnabled:true,reusableBinding:{ownerId:binding.ownerId,enrollmentId:binding.enrollmentId},...legacy});
  const testOnly=realMarkers?null:{synthetic:true,markerParentReady:()=>true,markerSpent:id=>spent.has(id),adapterFactory:o=>({kind:'groq-durable-one-shot',assistantId:binding.assistantId,ready:!spent.has(o.gate.grantId),canServeResults:true,async answer(input){spent.add(o.gate.grantId);calls++;if(mode==='uncertain')throw Object.assign(Error('synthetic'),{code:'groq_outcome_uncertain'});return {owner:input.owner,task:input.task,requestId:input.requestId,attempt:input.attempt,eventId:'resp:'+input.requestId,kind:'answer',outcomeKind:'information',body:output,statusChange:null};}})};
  router=createAdmissionAssistantAdapter({activationEnabled:true,signedBridgeEnabled:true,reusableBoardEnabled:true,workspaceEnabled:true,publicTestEnabled,bridgeKeyId:'fixture',loadPolicy:()=>policy,binding,apiKey,markerDirectory:dir,now,fetchImpl,testOnly,priorEnrollmentIds});
  router.attachStore(store,{accepting:()=>available});
  handler=createWorkspaceHandler({enabled:true,auth:auth??{authenticate:async token=>token===session},store,binding,origins:[origin],now,loadPolicy:()=>policy,currentAvailability:router.availability,readHistoricalModelProof,afterCommit:()=>{if(failResponse)throw Error('synthetic_lost_response');}});
  const relay={...store.relay,claimNext:input=>router.claimNext(input)};
  dispatcher=createDispatcher({store:relay,boardAdapter:{scopeEnforced:true,getTaskContext:relay.getTaskContext,appendReply:relay.appendReply,getReplyByRequestId:relay.getReplyByRequestId},assistantAdapter:router,enabled:true,now,workerId:'workspace-fixture',claimTtlMs:60000});
 }
 open();
 async function request(url,{body,headers={},raw,method=body===undefined&&raw===undefined?'GET':'POST'}={}){
  const req=Readable.from(body===undefined&&raw===undefined?[]:[Buffer.from(raw??JSON.stringify(body))]);Object.assign(req,{method,url,headers:{host:new URL(origin).host,origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie:'__Host-PicardSession='+fixtureToken,...headers}});
  const res={writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=JSON.parse(body);}};const handled=await handler(req,res);return {handled,...res};
 }
 const brief=(patch={})=>({requestId:randomUUID(),taskId:'',title:'A normal request',requestText:'Propose a tiny status-label helper. Include a focused check.',context:'Synthetic public specification only.',purpose:'sanitized-source-proposal',...patch});
 async function prepare(body=brief()){const r=await request('/workspace/drafts',{body});if(r.status!==201)throw Error(JSON.stringify(r));return r.body.draft;}
 async function approve(d){const r=await request('/workspace/approvals',{body:{requestId:d.payload.requestId}});if(r.status!==200)throw Error(JSON.stringify(r));return r.body;}
 const submit=(d,proof,patch={})=>request('/workspace/requests',{body:{requestId:d.payload.requestId,nonce:proof.nonce,draftSha256:d.draftSha256,approve:true,...patch}});
 return {dir,dbPath,binding,policy,now,brief,request,prepare,approve,submit,output:realMarkers?'[Groq / openai/gpt-oss-20b]\n'+output:output,auth,
  get handler(){return handler;},get store(){return store;},get router(){return router;},get dispatcher(){return dispatcher;},get calls(){return calls;},
  advance(ms){offset+=ms;},setMode(value){mode=value;},setAvailable(value){available=value;},loseResponse(value=true){failResponse=value;},rotateSession(){session='B'.repeat(43);},
  async rotateEnrollment({provePredecessor=false}={}){
   store.close();const prior={...enrollment};apiKey='SYNTHETIC_ROTATED_WORKSPACE_KEY_ONLY';enrollment.keySha256=await digest(apiKey);
   binding.keySha256=enrollment.keySha256;binding.enrollmentId=await digest(canonical(enrollment));binding.configurationSha256=await digest('SYNTHETIC_ROTATED_CONFIGURATION');
   policy.configurationSha256=binding.configurationSha256;policy.catalogue.enrollmentId=binding.enrollmentId;
   if(provePredecessor)priorEnrollmentIds=priorGroqEnrollmentIds({v:1,activeEnrollmentId:binding.enrollmentId,previous:[prior]},enrollment);
   open();
  },
  restart(){store.close();open();},close(){store.close();fs.rmSync(dir,{recursive:true,force:true});},
 };
}
