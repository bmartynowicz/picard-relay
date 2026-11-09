import {lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync,fstatSync,unlinkSync,readdirSync} from 'node:fs';
import {dirname,isAbsolute,resolve,join} from 'node:path';
import {createGroqAdapter,GROQ_ID,GROQ_MODEL,inputDigest,retainedCostScopeConfigured} from './groq-adapter.mjs';
import {canonical} from './protocol.mjs';
import {isDurableIncompleteFailureReceipt} from './relay-store.mjs';
import {AdapterBlockedError,InvocationIncompleteError,isIncompleteInvocation,sanitizeInvocationDiagnostic,invocationFailureCode,withInvocationDiagnostic,invocationDiagnostic} from './adapters.mjs';
export const PILOT_TEXT='Reply Hello World';
export const PILOT_CONTEXT=Object.freeze({title:'Relay Hello World verification',nextAction:'',latestFinding:''});
const blocked=code=>new AdapterBlockedError(code,code);
// Purpose describes input provenance; both values retain the same exact scope.
const REVIEW_PURPOSES=Object.freeze(['public-source-review','sanitized-source-proposal']);
/** One exact approved request, one durable allowance. Legacy pilot stays supported. */
export function createGroqOnceAdapter({enabled=false,apiKey='',gate=null,markerPath='',fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=30000,perGrantCostLatch=false}={}){
 let pendingIncomplete=null;
 // Snapshot administrator configuration: later caller mutation cannot widen scope.
 try{gate=JSON.parse(JSON.stringify(gate));}catch{gate=null;}
 function reviewScope(){
  const c=gate?.taskContext;
  return (gate?.v===2||gate?.v===3)&&REVIEW_PURPOSES.includes(gate.purpose)&&typeof gate.approvedRequestText==='string'&&gate.approvedRequestText.length>0&&gate.approvedRequestText.length<=4000&&c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='latestFinding,nextAction,title'&&typeof c.title==='string'&&c.title.length>0&&c.title.length<=200&&typeof c.nextAction==='string'&&c.nextAction.length<=1500&&typeof c.latestFinding==='string'&&c.latestFinding.length<=4000&&/^[a-f0-9]{64}$/.test(gate.eventId??'')&&typeof gate.grantId==='string'&&gate.grantId.length>0&&gate.grantId.length<=200&&/^[a-f0-9]{64}$/.test(gate.approvedInputSha256??'')&&gate.approvedInputSha256===inputDigest({requestText:gate.approvedRequestText,context:{taskContext:c}})&&Buffer.byteLength(JSON.stringify({request:gate.approvedRequestText,context:c}))<=12000;
 }
 function approvedScope(){return gate?.v===1?gate.approvedRequestText===PILOT_TEXT&&canonical(gate.taskContext)===canonical(PILOT_CONTEXT):reviewScope();}
 function privateParent(){try{if(!isAbsolute(markerPath)||resolve(markerPath)!==markerPath)return false;const parent=dirname(markerPath),s=lstatSync(parent);return s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.uid===process.getuid()&&realpathSync(parent)===parent;}catch{return false;}}
 function spent(){try{lstatSync(markerPath);return true;}catch(e){return e.code!=='ENOENT';}}
 function configured(){return enabled===true&&typeof apiKey==='string'&&!!apiKey.trim()&&!/[\r\n]/.test(apiKey)&&approvedScope()&&gate.provider==='groq'&&gate.model===GROQ_MODEL&&gate.harmlessTestOnly===true&&gate.maxCalls===1&&(gate.maxCompletionTokens===undefined||gate.v===3&&gate.maxCompletionTokens===4096)&&(gate.v===3?retainedCostScopeConfigured(gate,apiKey):gate.accountPlan==='Free'&&gate.noPaidFallback===true&&typeof gate.evidenceRef==='string'&&!!gate.evidenceRef&&Number.isFinite(gate.verifiedAt)&&Number.isFinite(gate.validUntil)&&gate.validUntil>gate.verifiedAt&&gate.validUntil-gate.verifiedAt<=3600000)&&['owner','task'].every(k=>typeof gate[k]==='string'&&gate[k].length>0&&gate[k].length<=200)&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000&&privateParent();}
 // Legacy v3 uses an enrollment-wide reservation. Reusable Board work can
 // isolate the reservation to its own grant; its consumed marker remains durable.
 // No reservation is automatically reused or retried.
 function costLatch(){return perGrantCostLatch===true?`${markerPath}.pending`:join(dirname(markerPath),`.groq-cost-${gate.enrollmentId}.pending`);}
 function costStopped(){
  if(gate?.v!==3)return false;
  // Shared reservations survive key/enrollment rotation. Names alone stop use;
  // never read, rewrite or acknowledge a prior process's pending evidence.
  try{const names=readdirSync(dirname(markerPath));if(names.length>1024||names.some(name=>name.startsWith('.groq-cost-')))return true;}catch{return true;}
  try{lstatSync(costLatch());return true;}catch(e){return e.code!=='ENOENT';}
 }
 function ready(){return configured()&&(gate.v===3?gate.requestIssuedAt<=now()&&now()<gate.requestExpiresAt:gate.verifiedAt<=now()&&now()<gate.validUntil)&&!spent()&&!costStopped();}
 function syncParent(){const fd=openSync(dirname(markerPath),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
 function reserveCost(){let fd;try{fd=openSync(costLatch(),'wx',0o600);writeFileSync(fd,JSON.stringify({v:1,enrollmentId:gate.enrollmentId,state:'pending-before-io'}));fsyncSync(fd);const identity=fstatSync(fd);syncParent();return identity;}catch{throw blocked('groq_cost_enrollment_stopped');}finally{if(fd!==undefined)closeSync(fd);}}
 function releaseCost(identity){const s=lstatSync(costLatch());if(['dev','ino','mode','uid','gid','nlink','size','mtimeMs','ctimeMs'].some(key=>s[key]!==identity[key]))throw Error('groq_outcome_uncertain');unlinkSync(costLatch());syncParent();}
 function matches(owner,task,text,context){return owner===gate?.owner&&task===gate?.task&&text===gate?.approvedRequestText&&canonical(context)===canonical(gate?.taskContext);}
 function reserve(input){let fd;try{fd=openSync(markerPath,'wx',0o600);writeFileSync(fd,JSON.stringify({v:1,provider:'groq',model:GROQ_MODEL,owner:input.owner,task:input.task,requestId:input.requestId,invocationId:input.invocationId,startedAt:new Date(now()).toISOString(),state:'consumed-before-io'}));fsyncSync(fd);}catch{throw blocked('groq_once_allowance_unavailable');}finally{if(fd!==undefined)closeSync(fd);}const directory=openSync(dirname(markerPath),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
 return {kind:'groq-durable-one-shot',assistantId:GROQ_ID,get ready(){return ready();},get canServeResults(){return configured();},
  acceptsWorkScope(payload){return configured()&&payload?.request?.answerTo===null&&matches(payload?.ownerId,payload?.taskId,payload?.request?.text,payload?.context)&&(gate.v===1||(payload?.eventId===gate.eventId&&payload?.grantId===gate.grantId))&&(gate.v!==3||payload?.grantExpiresAt===gate.requestExpiresAt);},
  // Only the same live reservation may settle after durable terminal failure.
  // Old stops and reconstructed adapters cannot acknowledge it.
  async finalizeIncomplete({requestId,error,failureReceipt}={}){
   if(gate?.v!==3)return false;
   if(!pendingIncomplete||pendingIncomplete.requestId!==requestId||pendingIncomplete.error!==error||!isIncompleteInvocation(error)||!isDurableIncompleteFailureReceipt(failureReceipt,requestId))throw blocked('groq_cost_enrollment_stopped');
   releaseCost(pendingIncomplete.identity);pendingIncomplete=null;return true;
  },
  async answer(input){
   let diagnostic=sanitizeInvocationDiagnostic(null);
   const report=async value=>{diagnostic=sanitizeInvocationDiagnostic({...diagnostic,...value});try{await input.onDiagnostic?.(diagnostic);}catch{throw withInvocationDiagnostic(Object.assign(Error('groq_outcome_uncertain'),{code:'groq_outcome_uncertain'}),{...diagnostic,phase:'unknown',code:'diagnostic_persistence_failed'});}};
   const denied=(code,detail)=>withInvocationDiagnostic(blocked(code),{phase:'pre_send',code:detail});
   try{
   if(!ready())throw denied('groq_free_scope_unavailable','scope_unavailable');
   if(((gate.v===2||gate.v===3)&&(input.context?.grantId!==gate.grantId||input.requestId!==gate.eventId||inputDigest(input)!==gate.approvedInputSha256))||!matches(input.owner,input.task,input.requestText,input.context?.taskContext)||typeof input.requestId!=='string'||!/^[a-f0-9]{64}$/.test(input.requestId)||input.invocationId!==input.requestId||!Number.isSafeInteger(input.attempt)||input.attempt<1)throw denied('groq_scope_mismatch','scope_mismatch');
   if(input.signal?.aborted)throw denied('groq_cancelled_before_send','cancelled_before_send');
   const exactGate={...gate,requestId:input.requestId,inputSha256:inputDigest(input)};
   const adapter=createGroqAdapter({enabled:true,apiKey,gate:exactGate,fetchImpl,now,timeoutMs});
   if(!adapter.ready)throw denied('groq_free_scope_unavailable','scope_unavailable');
   await report({phase:'reservation',code:'reservation_started'});
   reserve(input); // Must be durable before the existing adapter can attempt network I/O.
   await report({phase:'reservation',code:'one_shot_reserved'});
   const scopedInput={...input,onDiagnostic:report};
   if(gate.v===3){await report({phase:'reservation',code:'cost_reservation_started'});const identity=reserveCost();await report({phase:'reservation',code:'cost_reserved'});let result;try{result=await adapter.answer(scopedInput);}catch(e){if(isIncompleteInvocation(e))pendingIncomplete={identity,requestId:input.requestId,error:null};throw e;}await report({phase:'reservation',code:'cost_release_started'});try{releaseCost(identity);}catch{throw withInvocationDiagnostic(Error('groq_outcome_uncertain'),{...diagnostic,phase:'reservation',code:'cost_release_failed'});}return result;}
   return await adapter.answer(scopedInput);
   }catch(e){
    const error=isIncompleteInvocation(e)?new InvocationIncompleteError():e instanceof AdapterBlockedError?blocked(invocationFailureCode(e.code)):Object.assign(Error('groq_outcome_uncertain'),{code:'groq_outcome_uncertain'});
    withInvocationDiagnostic(error,invocationDiagnostic(e)??{...diagnostic,phase:'reservation',code:'reservation_failed'});
    if(pendingIncomplete&&isIncompleteInvocation(error))pendingIncomplete.error=error;
    throw error;
   }
  }
 };
}
