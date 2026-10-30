import {lstatSync,realpathSync,openSync,writeFileSync,fsyncSync,closeSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {createGroqAdapter,GROQ_ID,GROQ_MODEL,inputDigest} from './groq-adapter.mjs';
import {canonical} from './protocol.mjs';
import {AdapterBlockedError} from './adapters.mjs';
export const PILOT_TEXT='Reply Hello World';
export const PILOT_CONTEXT=Object.freeze({title:'Relay Hello World verification',nextAction:'',latestFinding:''});
const blocked=code=>new AdapterBlockedError(code,code);
// Purpose describes input provenance; both values retain the same exact scope.
const REVIEW_PURPOSES=Object.freeze(['public-source-review','sanitized-source-proposal']);
/** One exact approved request, one durable allowance. Legacy pilot stays supported. */
export function createGroqOnceAdapter({enabled=false,apiKey='',gate=null,markerPath='',fetchImpl=globalThis.fetch,now=Date.now,timeoutMs=30000}={}){
 // Snapshot administrator configuration: later caller mutation cannot widen scope.
 try{gate=JSON.parse(JSON.stringify(gate));}catch{gate=null;}
 function reviewScope(){
  const c=gate?.taskContext;
  return gate?.v===2&&REVIEW_PURPOSES.includes(gate.purpose)&&typeof gate.approvedRequestText==='string'&&gate.approvedRequestText.length>0&&gate.approvedRequestText.length<=4000&&c&&typeof c==='object'&&!Array.isArray(c)&&Object.keys(c).sort().join(',')==='latestFinding,nextAction,title'&&typeof c.title==='string'&&c.title.length>0&&c.title.length<=200&&typeof c.nextAction==='string'&&c.nextAction.length<=1500&&typeof c.latestFinding==='string'&&c.latestFinding.length<=4000&&/^[a-f0-9]{64}$/.test(gate.eventId??'')&&typeof gate.grantId==='string'&&gate.grantId.length>0&&gate.grantId.length<=200&&/^[a-f0-9]{64}$/.test(gate.approvedInputSha256??'')&&gate.approvedInputSha256===inputDigest({requestText:gate.approvedRequestText,context:{taskContext:c}})&&Buffer.byteLength(JSON.stringify({request:gate.approvedRequestText,context:c}))<=12000;
 }
 function approvedScope(){return gate?.v===1?gate.approvedRequestText===PILOT_TEXT&&canonical(gate.taskContext)===canonical(PILOT_CONTEXT):reviewScope();}
 function privateParent(){try{if(!isAbsolute(markerPath)||resolve(markerPath)!==markerPath)return false;const parent=dirname(markerPath),s=lstatSync(parent);return s.isDirectory()&&!s.isSymbolicLink()&&(s.mode&0o077)===0&&s.uid===process.getuid()&&realpathSync(parent)===parent;}catch{return false;}}
 function spent(){try{lstatSync(markerPath);return true;}catch(e){return e.code!=='ENOENT';}}
 function configured(){return enabled===true&&typeof apiKey==='string'&&!!apiKey.trim()&&!/[\r\n]/.test(apiKey)&&approvedScope()&&gate.provider==='groq'&&gate.model===GROQ_MODEL&&gate.accountPlan==='Free'&&gate.noPaidFallback===true&&gate.harmlessTestOnly===true&&gate.maxCalls===1&&typeof gate.evidenceRef==='string'&&!!gate.evidenceRef&&['owner','task'].every(k=>typeof gate[k]==='string'&&gate[k].length>0&&gate[k].length<=200)&&Number.isFinite(gate.verifiedAt)&&Number.isFinite(gate.validUntil)&&gate.validUntil>gate.verifiedAt&&gate.validUntil-gate.verifiedAt<=3600000&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1&&timeoutMs<=30000&&privateParent();}
 function ready(){return configured()&&gate.verifiedAt<=now()&&now()<gate.validUntil&&!spent();}
 function matches(owner,task,text,context){return owner===gate?.owner&&task===gate?.task&&text===gate?.approvedRequestText&&canonical(context)===canonical(gate?.taskContext);}
 function reserve(input){let fd;try{fd=openSync(markerPath,'wx',0o600);writeFileSync(fd,JSON.stringify({v:1,provider:'groq',model:GROQ_MODEL,owner:input.owner,task:input.task,requestId:input.requestId,invocationId:input.invocationId,startedAt:new Date(now()).toISOString(),state:'consumed-before-io'}));fsyncSync(fd);}catch{throw blocked('groq_once_allowance_unavailable');}finally{if(fd!==undefined)closeSync(fd);}const directory=openSync(dirname(markerPath),'r');try{fsyncSync(directory);}finally{closeSync(directory);}}
 return {kind:'groq-durable-one-shot',assistantId:GROQ_ID,get ready(){return ready();},get canServeResults(){return configured();},
  acceptsWorkScope(payload){return configured()&&payload?.request?.answerTo===null&&matches(payload?.ownerId,payload?.taskId,payload?.request?.text,payload?.context)&&(gate.v===1||(payload?.eventId===gate.eventId&&payload?.grantId===gate.grantId));},
  async answer(input){
   if(!ready())throw blocked('groq_free_scope_unavailable');
   if((gate.v===2&&(input.context?.grantId!==gate.grantId||input.requestId!==gate.eventId||inputDigest(input)!==gate.approvedInputSha256))||!matches(input.owner,input.task,input.requestText,input.context?.taskContext)||typeof input.requestId!=='string'||!/^[a-f0-9]{64}$/.test(input.requestId)||input.invocationId!==input.requestId||!Number.isSafeInteger(input.attempt)||input.attempt<1)throw blocked('groq_scope_mismatch');
   if(input.signal?.aborted)throw blocked('groq_cancelled_before_send');
   const exactGate={...gate,requestId:input.requestId,inputSha256:inputDigest(input)};
   const adapter=createGroqAdapter({enabled:true,apiKey,gate:exactGate,fetchImpl,now,timeoutMs});
   if(!adapter.ready)throw blocked('groq_free_scope_unavailable');
   reserve(input); // Must be durable before the existing adapter can attempt network I/O.
   return adapter.answer(input);
  }
 };
}
