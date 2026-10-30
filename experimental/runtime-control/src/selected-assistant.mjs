import {groqHttpsFetch} from './https-fetch.mjs';
import {readFileSync,lstatSync} from 'node:fs';
import {AdapterBlockedError,createRealAssistantAdapter} from './adapters.mjs';
import {GROQ_ID,GROQ_MODEL} from './groq-adapter.mjs';
import {createGroqOnceAdapter} from './groq-once-adapter.mjs';

// Admission around the existing externally attested Free pilot, not a billing
// API or a grant. This policy cannot replenish the durable one-use marker.
export const FREE_ONLY_ROUTING_POLICY=Object.freeze({
 id:'free-only-one-shot-v1',provider:'groq',model:GROQ_MODEL,
 maxCalls:1,maxInputBytes:12000,maxResponseBytes:65536,
 maxCompletionTokens:512,timeoutMs:30000,retries:0,fallbacks:0,
 productionTaskExecution:false,
});
const denied=()=>new AdapterBlockedError('groq_free_scope_unavailable','groq_free_scope_unavailable');
export function createFreeOnlyRoutingAdapter(adapter){
 const supported=adapter?.kind==='groq-durable-one-shot'&&adapter.assistantId===GROQ_ID;
 let attempted=false;
 const ready=()=>supported&&!attempted&&adapter.ready===true;
 return Object.freeze({
  kind:'groq-free-only-one-shot',assistantId:GROQ_ID,routingPolicy:FREE_ONLY_ROUTING_POLICY,
  get ready(){return ready();},
  // Stored results remain recoverable when the allowance is spent or expired.
  get canServeResults(){return supported&&adapter.canServeResults===true;},
  acceptsWorkScope(payload){return supported&&adapter.acceptsWorkScope(payload)===true;},
  async answer(input){
   if(!ready())throw denied();
   // Reserve synchronously before awaiting the sole adapter. Rejections,
   // quota/payment errors and ambiguous outcomes never restore capacity.
   attempted=true;
   return adapter.answer(input);
  },
 });
}
function privateFile(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>16384)throw Error('groq_private_config_invalid');return readFileSync(path,'utf8');}
export function createSelectedAssistantAdapter(e=process.env){
 if(e.BRIDGE_PROVIDER!=='groq')return createRealAssistantAdapter();
 // The ephemeral adapter remains an offline library fixture, never a
 // production alternative to the durable one-use pilot.
 if(e.GROQ_ENABLED!=='true'||e.BRIDGE_ASSISTANT_ID!==GROQ_ID||e.GROQ_ONE_SHOT!=='true')return createFreeOnlyRoutingAdapter();
 // Key and nonsecret gate are separate private files provisioned only after explicit authorization.
 const apiKey=privateFile(e.GROQ_API_KEY_FILE).trim(),gate=JSON.parse(privateFile(e.GROQ_FREE_GATE_FILE));
 if(gate.owner!==e.BRIDGE_OWNER_ID||gate.task!==e.BRIDGE_ALLOWED_TASK_ID)throw Error('groq_scope_config_mismatch');
 return createFreeOnlyRoutingAdapter(createGroqOnceAdapter({enabled:true,apiKey,gate,markerPath:e.GROQ_ONCE_MARKER_FILE??'',fetchImpl:groqHttpsFetch}));
}
