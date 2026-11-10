// Codex's native agent-turn-complete callback. Only usage metadata leaves this machine.
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {mkdir,readdir,readFile,rename,rm,stat,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const slug=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/;
const metrics=['input_tokens','cached_input_tokens','output_tokens'];
const validUsage=usage=>usage&&metrics.every(key=>Number.isSafeInteger(usage[key])&&usage[key]>=0);

export async function readCompletedCodexUsage(path,turnId,{serverName='picard'}={}){
 const size=(await stat(path)).size;
 if(size>64*1024*1024)throw Error('transcript_too_large');
 const stream=createReadStream(path,{encoding:'utf8'});
 const lines=createInterface({input:stream,crlfDelay:Infinity});
 const zeros=Object.fromEntries(metrics.map(key=>[key,0]));
 let active=false,completeAt=null,model=null,effort=null,before=zeros,latest=null,previous=zeros;
 const calls=new Map(),tools=new Set();
 try{
  for await(const line of lines){
   let event;try{event=JSON.parse(line);}catch{continue;}
   const p=event?.payload;
   if(!p)continue;
   if(event.type==='event_msg'){
    if(p.type==='task_started'){
     if(active)break;
     if(p.turn_id===turnId){active=true;before=previous;}
    }else if(p.type==='token_count'&&validUsage(p.info?.total_token_usage)){
     previous=p.info.total_token_usage;
     if(active)latest=previous;
    }else if(active&&p.type==='task_complete'&&p.turn_id===turnId){
     completeAt=Number.isSafeInteger(p.completed_at)?p.completed_at*1000:Date.parse(event.timestamp);
     break;
    }else if(active&&p.type==='mcp_tool_call_end'&&p.invocation?.server===serverName
      &&slug.test(p.invocation?.tool??'')&&p.result?.Ok&&p.result.Ok.isError!==true&&p.result.Ok.is_error!==true){
     tools.add(p.invocation.tool);
    }
   }else if(active&&event.type==='turn_context'&&p.turn_id===turnId){
    model=typeof p.model==='string'&&slug.test(p.model)?p.model:null;
    effort=typeof p.effort==='string'&&slug.test(p.effort)?p.effort:null;
   }else if(active&&event.type==='response_item'){
    const prefix='mcp__'+serverName+'__';
    if(p.type==='function_call'&&typeof p.name==='string'&&p.name.startsWith(prefix)&&slug.test(p.name.slice(prefix.length)))
     calls.set(p.call_id,p.name.slice(prefix.length));
    if(p.type==='function_call_output'&&calls.has(p.call_id)){
     let output=p.output;
     if(typeof output==='string'){try{output=JSON.parse(output);}catch{output=null;}}
     if(output?.isError!==true&&output?.is_error!==true
      &&(output?.isError===false||output?.is_error===false||output?.structuredContent||output?.structured_content))
      tools.add(calls.get(p.call_id));
    }
   }
  }
 }finally{lines.close();stream.destroy();}
 if(!latest||!model||!Number.isSafeInteger(completeAt)||completeAt<1)return null;
 const [inputTokens,cachedInputTokens,outputTokens]=metrics.map(key=>latest[key]-before[key]);
 if(inputTokens<0||cachedInputTokens<0||cachedInputTokens>inputTokens||outputTokens<0||inputTokens+outputTokens===0)return null;
 return {model,effort,recordedAt:completeAt,inputTokens,cachedInputTokens,outputTokens,tools:[...tools].sort().slice(0,20)};
}

async function transcriptPath(root,threadId){
 // Native Codex thread IDs contain their creation time (UUIDv7).
 if(threadId[14]!=='7')throw Error('unsupported_thread_id');
 const created=Number.parseInt(threadId.slice(0,8)+threadId.slice(9,13),16);
 for(const offset of [0,-1,1]){
  const [year,month,day]=new Date(created+offset*86400000).toISOString().slice(0,10).split('-');
  const folder=join(root,'sessions',year,month,day);
  const names=await readdir(folder).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
  const match=names.find(name=>name.startsWith('rollout-')&&name.endsWith('-'+threadId+'.jsonl'));
  if(match)return join(folder,match);
 }
 throw Error('transcript_not_found');
}

export async function readCodexExecTools(path,threadId,usage,serverName){
 const size=(await stat(path)).size;
 if(size>8*1024*1024)throw Error('exec_events_too_large');
 const events=(await readFile(path,'utf8')).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line));
 const completion=events.find(event=>event.type==='turn.completed')?.usage;
 if(events[0]?.type!=='thread.started'||events[0].thread_id!==threadId
  ||events.filter(event=>event.type==='turn.started').length!==1||!validUsage(completion)
  ||completion.input_tokens!==usage.inputTokens||completion.cached_input_tokens!==usage.cachedInputTokens
  ||completion.output_tokens!==usage.outputTokens)return null;
 return events.filter(event=>event.type==='item.completed'&&event.item?.type==='mcp_tool_call'
  &&event.item.server===serverName&&event.item.status==='completed'&&slug.test(event.item.tool??'')
  &&event.item.result?.isError!==true&&event.item.result?.is_error!==true&&!event.item.error)
  .map(event=>event.item.tool);
}

function endpointFor(value){
 const endpoint=new URL(value);
 if((endpoint.protocol!=='https:'&&!(endpoint.protocol==='http:'&&endpoint.hostname==='127.0.0.1'))
  ||endpoint.username||endpoint.password||endpoint.search||endpoint.hash||endpoint.pathname!=='/codex/usage')
  throw Error('invalid_usage_endpoint');
 return endpoint;
}

async function flush(outbox,endpoint,token,latestFile){
 const pending=(await readdir(outbox)).filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).sort();
 const names=[latestFile,...pending.filter(name=>name!==latestFile).slice(0,7)];
 let delivered=false;
 for(const name of names){
  const path=join(outbox,name);
  const body=await readFile(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(body===null)continue;
  if(body.length>4096)throw Error('invalid_pending_record');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),
   headers:{authorization:'Bearer '+token,'content-type':'application/json'},body});
  await response.body?.cancel();
  if(response.ok){await rm(path,{force:true});if(name===latestFile)delivered=true;}
  else if(response.status===400||response.status===409){
   await rename(path,path+'.rejected').catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
  else break;
 }
 return delivered;
}

async function main(){
 const {values,positionals}=parseArgs({allowPositionals:true,options:{
  endpoint:{type:'string'},'token-file':{type:'string'},'codex-home':{type:'string'},outbox:{type:'string'},
  'server-name':{type:'string',default:'picard'},'exec-events':{type:'string'},comparison:{type:'string'},variant:{type:'string'}
 }});
 const notice=JSON.parse(positionals[0]??'null');
 if(notice?.type!=='agent-turn-complete')return;
 const thread=notice['thread-id'],turn=notice['turn-id'];
 if(!uuid.test(thread??'')||!uuid.test(turn??'')||!slug.test(values['server-name']))throw Error('invalid_codex_notification');
 const endpoint=endpointFor(values.endpoint);
 const tokenFile=resolve(values['token-file']);
 const token=(await readFile(tokenFile,'utf8')).trimEnd();
 if(!/^[a-f0-9]{64}$/.test(token))throw Error('invalid_usage_token');
 if((values.comparison!==undefined||values.variant!==undefined)&&(!slug.test(values.comparison??'')||!['baseline','assisted'].includes(values.variant)))
  throw Error('invalid_comparison');
 const path=await transcriptPath(values['codex-home']??process.env.CODEX_HOME??join(homedir(),'.codex'),thread);
 let usage,execTools;
 for(const wait of [0,250,500,1000]){
  if(wait)await delay(wait);
  usage=await readCompletedCodexUsage(path,turn,{serverName:values['server-name']});
  if(usage&&values['exec-events'])execTools=await readCodexExecTools(values['exec-events'],thread,usage,values['server-name']).catch(()=>null);
  if(usage&&(!values['exec-events']||execTools))break;
 }
 if(!usage)throw Error('completed_usage_unavailable');
 if(execTools)usage.tools=[...new Set([...usage.tools,...execTools])].sort().slice(0,20);
 const matches=(!values['exec-events']||execTools!==null&&execTools!==undefined)
  &&(values.variant==='baseline'?!usage.tools.length:values.variant==='assisted'&&usage.tools.length>0);
 const id=createHash('sha256').update(thread+'\n'+turn).digest('hex');
 const record={v:1,id,...usage,comparisonId:matches?values.comparison:null,variant:matches?values.variant:null};
 const outbox=resolve(values.outbox??join(dirname(tokenFile),'codex-usage-pending'));
 await mkdir(outbox,{recursive:true,mode:0o700});
 const filename=id+'.json',pending=join(outbox,filename),temporary=join(outbox,id+'-'+randomUUID()+'.tmp');
 await writeFile(temporary,JSON.stringify(record),{flag:'wx',mode:0o600});
 try{await rename(temporary,pending);}finally{await rm(temporary,{force:true});}
 if(!await flush(outbox,endpoint,token,filename))throw Error('usage_not_delivered');
 if(values.comparison&&!matches)process.stderr.write('Picard recorded usage without a comparison. The run did not match the selected variant.\n');
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}
 catch{process.stderr.write('Picard could not record or deliver this Codex run. Check the local setup and pending records.\n');process.exitCode=1;}
}
