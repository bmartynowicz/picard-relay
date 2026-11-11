#!/usr/bin/env node
// Count real coordinator model passes during a bounded task phase. No prompts,
// tool payloads, private paths or credentials are sent to Savings.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
const hash=value=>createHash('sha256').update(value).digest('hex');
const count=n=>Number.isSafeInteger(n)&&n>=0&&n<=1_000_000_000;
const slug=s=>typeof s==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(s);
async function log(path){
 const info=await stat(path);if(!info.isFile()||info.size>64*1024*1024)throw Error('bounded_native_log_required');
 const bytes=await readFile(path);if(bytes.length>64*1024*1024||bytes.at(-1)!==10)throw Error('complete_log_lines_required');
 return bytes;
}
function context(bytes){
 let last=null;for(const line of bytes.toString('utf8').split('\n')){if(!line)continue;const e=JSON.parse(line);if(e.type==='turn_context')last=e.payload;}
 if(!last||!slug(last.model)||!slug(last.effort)||typeof last.turn_id!=='string')throw Error('native_context_unavailable');
 return {model:last.model,effort:last.effort,turnId:last.turn_id};
}
export async function beginSpan(path){
 const bytes=await log(path);return {v:1,path,offset:bytes.length,prefixSha256:hash(bytes),...context(bytes)};
}
export async function finishSpan(checkpoint){
 const bytes=await log(checkpoint.path);
 if(checkpoint.v!==1||!Number.isSafeInteger(checkpoint.offset)||checkpoint.offset<1||checkpoint.offset>bytes.length
  ||hash(bytes.subarray(0,checkpoint.offset))!==checkpoint.prefixSha256)throw Error('native_log_changed');
 const current=context(bytes);if(JSON.stringify(current)!==JSON.stringify({model:checkpoint.model,effort:checkpoint.effort,turnId:checkpoint.turnId}))throw Error('native_context_changed');
 const usage={inputTokens:0,cachedInputTokens:0,outputTokens:0};let passes=0;
 for(const line of bytes.subarray(checkpoint.offset).toString('utf8').split('\n')){
  if(!line)continue;const event=JSON.parse(line);if(event.type!=='token_usage_record')continue;
  const u=event.payload?.usage;
  if(!u||![u.input_tokens,u.cached_input_tokens,u.output_tokens].every(count)||u.cached_input_tokens>u.input_tokens)throw Error('invalid_native_usage');
  usage.inputTokens+=u.input_tokens;usage.cachedInputTokens+=u.cached_input_tokens;usage.outputTokens+=u.output_tokens;passes++;
 }
 if(!passes||usage.inputTokens+usage.outputTokens===0||!Object.values(usage).every(count))throw Error('native_usage_unavailable');
 const record={v:1,id:hash(checkpoint.prefixSha256+'\n'+hash(bytes)+'\n'+checkpoint.turnId),model:checkpoint.model,effort:checkpoint.effort,
  recordedAt:Date.now(),...usage,tools:[],comparisonId:null,variant:null};
 return {record,modelPasses:passes,fromOffset:checkpoint.offset,toOffset:bytes.length,sourceSha256:hash(bytes)};
}
async function main(){
 const [command,...args]=process.argv.slice(2);const {values}=parseArgs({args,options:{transcript:{type:'string'},checkpoint:{type:'string'},out:{type:'string'}}});
 if(!values.out)throw Error('new_output_required');
 let value;
 if(command==='begin')value=await beginSpan(values.transcript);
 else if(command==='finish'){
  const receipt=values.checkpoint+'.finished.json';
  try{value=JSON.parse(await readFile(receipt,'utf8'));}catch(error){
   if(error.code!=='ENOENT')throw error;
   value=await finishSpan(JSON.parse(await readFile(values.checkpoint,'utf8')));
   await writeFile(receipt,JSON.stringify(value)+'\n',{flag:'wx',mode:0o600});
  }
 }
 if(!value)throw Error('use_begin_or_finish');await writeFile(values.out,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify(command==='begin'?{state:'started'}:{state:'measured',...value.record,modelPasses:value.modelPasses}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('Native phase measurement unavailable; retain the checkpoint.');process.exitCode=1;});
