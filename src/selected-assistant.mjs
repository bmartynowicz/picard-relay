import {readFileSync,lstatSync} from 'node:fs';
import {createRealAssistantAdapter} from './adapters.mjs';
import {createGroqAdapter,GROQ_ID} from './groq-adapter.mjs';
import {createGroqOnceAdapter} from './groq-once-adapter.mjs';
function privateFile(path){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||(s.mode&0o077)!==0||s.size>16384)throw Error('groq_private_config_invalid');return readFileSync(path,'utf8');}
export function createSelectedAssistantAdapter(e=process.env){
 if(e.BRIDGE_PROVIDER!=='groq')return createRealAssistantAdapter();
 if(e.GROQ_ENABLED!=='true'||e.BRIDGE_ASSISTANT_ID!==GROQ_ID)return createGroqAdapter();
 // Key and nonsecret gate are separate private files provisioned only after explicit authorization.
 const apiKey=privateFile(e.GROQ_API_KEY_FILE).trim(),gate=JSON.parse(privateFile(e.GROQ_FREE_GATE_FILE));
 if(e.GROQ_ONE_SHOT==='true'&&(gate.owner!==e.BRIDGE_OWNER_ID||gate.task!==e.BRIDGE_ALLOWED_TASK_ID))throw Error('groq_scope_config_mismatch');
 if(e.GROQ_ONE_SHOT==='true')return createGroqOnceAdapter({enabled:true,apiKey,gate,markerPath:e.GROQ_ONCE_MARKER_FILE??''});
 return createGroqAdapter({enabled:true,apiKey,gate});
}
